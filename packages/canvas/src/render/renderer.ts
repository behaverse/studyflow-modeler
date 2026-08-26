/**
 * Per-type renderer dispatch (design §3 `render/renderer.ts`, mirrors the modeler's
 * `draw/Renderer.drawShape`). Given a {@link Scene}, draws every node into the
 * shapes layer and every edge into the connections layer, each as one `<g>` placed
 * at its DI bounds. Read-only for P1: no interaction, no writeback.
 *
 * Node types are categorized from the business-object `$type` local name (no
 * bpmn-js `ModelUtil.is`); the drawer set is the finite studyflow vocabulary
 * (design §2). Icons are placeholders unless an {@link IconResolver} is injected.
 */

import { BPMN } from '@core/constants.ts';
import { getAttribute, isDataOperationActivity } from '@core/element/index.ts';
import { toLocalName } from '@core/naming.ts';

import { readChoreographyBands } from '@canvas/model/choreography.ts';
import { isCollapsed, isHiddenByCollapse } from '@canvas/model/expand.ts';
import { prop } from '@canvas/model/moddle.ts';
import type {
  ModdleObject,
  Scene,
  SceneEdge,
  SceneElement,
  SceneNode,
} from '@canvas/model/scene.ts';
import { append, attr, create, group, remove } from '@canvas/render/svg.ts';
import {
  bandPath,
  choreographyBandHeight,
  drawDataObject,
  drawDataStore,
  drawDiamond,
  drawEvent,
  drawGroup,
  drawParticipant,
  drawTask,
  drawTextAnnotation,
  CORNER_RADIUS,
  type EventKind,
  type ShapeStyle,
} from '@canvas/render/shapes.ts';
import {
  drawBandText,
  drawEdgeLabel,
  drawExternalLabel,
  drawInternalLabel,
} from '@canvas/render/labels.ts';
import {
  drawIcon,
  type IconResolver,
} from '@canvas/render/icons.ts';

/**
 * Category of a node type — selects the base drawer, and (exported through
 * {@link categoryOf}) the label placement `interaction/labelEditing.ts` mirrors.
 */
export type NodeCategory =
  | 'event'
  | 'task'
  | 'gateway'
  | 'data'
  | 'choreography'
  | 'group'
  | 'annotation'
  | 'participant'
  | 'unknown';

const EVENT_TYPES = new Set<string>([
  BPMN.StartEvent, BPMN.EndEvent, BPMN.IntermediateThrowEvent,
  BPMN.IntermediateCatchEvent, BPMN.BoundaryEvent,
]);
const TASK_TYPES = new Set<string>([
  BPMN.Task, BPMN.UserTask, BPMN.ServiceTask, BPMN.ScriptTask, BPMN.ManualTask,
  BPMN.SendTask, BPMN.ReceiveTask, BPMN.BusinessRuleTask, BPMN.CallActivity,
  BPMN.SubProcess,
  'bpmn:AdHocSubProcess', 'bpmn:Transaction',
]);
const GATEWAY_TYPES = new Set<string>([
  BPMN.ExclusiveGateway, BPMN.ParallelGateway, BPMN.InclusiveGateway,
  BPMN.ComplexGateway, BPMN.EventBasedGateway,
]);
const DATA_TYPES = new Set<string>([
  BPMN.DataObjectReference, BPMN.DataStoreReference, BPMN.DataObject,
]);
const THICK_ACTIVITY = new Set<string>([BPMN.CallActivity, 'bpmn:Transaction']);

/** Gateway icon glyphs (placeholder text drawn centred in the diamond). */
const GATEWAY_GLYPH: Record<string, string> = {
  [BPMN.ExclusiveGateway]: '×',
  [BPMN.ParallelGateway]: '+',
  [BPMN.InclusiveGateway]: '○',
  [BPMN.ComplexGateway]: '✳',
  [BPMN.EventBasedGateway]: '⬠',
};

const EDGE_TYPES = new Set<string>([
  BPMN.SequenceFlow, BPMN.MessageFlow, BPMN.Association,
  'bpmn:DataInputAssociation', 'bpmn:DataOutputAssociation',
]);

/** The drawer category of a business-object `$type` (`'bpmn:UserTask'` → `'task'`). */
export function categoryOf(type: string): NodeCategory {
  if (type === BPMN.ChoreographyTask) return 'choreography';
  if (EVENT_TYPES.has(type)) return 'event';
  if (TASK_TYPES.has(type)) return 'task';
  if (GATEWAY_TYPES.has(type)) return 'gateway';
  if (DATA_TYPES.has(type)) return 'data';
  if (type === BPMN.Group) return 'group';
  if (type === BPMN.TextAnnotation) return 'annotation';
  if (type === BPMN.Participant || type === BPMN.Lane) return 'participant';
  return 'unknown';
}

function eventKind(node: SceneNode): EventKind {
  switch (node.type) {
    case BPMN.EndEvent: return 'end';
    case BPMN.IntermediateThrowEvent: return 'intermediateThrow';
    case BPMN.IntermediateCatchEvent: return 'intermediateCatch';
    case BPMN.BoundaryEvent: return 'boundary';
    default: return 'start';
  }
}

// --- colors -----------------------------------------------------------------

const DEFAULT_STROKE = '#22242A';
const DEFAULT_FILL = '#ffffff';

/** First defined color among a set of bpmn.io / DI attribute names. */
function colorAttr(di: ModdleObject | undefined, names: string[]): string | undefined {
  for (const name of names) {
    const value = prop(di, name);
    if (typeof value === 'string' && value) return value;
  }
  return undefined;
}

function strokeOf(node: SceneNode): string {
  return colorAttr(node.di, ['stroke', 'border-color', 'bioc:stroke', 'color:border-color']) ?? DEFAULT_STROKE;
}

function fillOf(node: SceneNode): string {
  return colorAttr(node.di, ['fill', 'background-color', 'bioc:fill', 'color:background-color']) ?? DEFAULT_FILL;
}

function styleOf(node: SceneNode): ShapeStyle {
  return { stroke: strokeOf(node), fill: fillOf(node) };
}

/** Options controlling the renderer. */
export interface RendererOptions {
  /** Injected icon source; when absent, icons render as placeholders (design §5). */
  iconResolver?: IconResolver;
}

/**
 * Draws a {@link Scene} into a shapes layer and a connections layer. Holds a
 * `graphicsById` map (element id → its `<g>`) for later hit-testing / selection.
 */
export class Renderer {
  private readonly iconResolver?: IconResolver;
  readonly graphicsById = new Map<string, SVGGElement>();

  constructor(options: RendererOptions = {}) {
    this.iconResolver = options.iconResolver;
  }

  /**
   * Render every node and edge of `scene` into the given layers. Nodes are drawn
   * ancestors-first so containers sit behind their children; edges go under nodes.
   */
  renderScene(scene: Scene, shapesLayer: SVGElement, connectionsLayer: SVGElement): void {
    this.graphicsById.clear();

    const nodes: SceneNode[] = [];
    const edges: SceneEdge[] = [];
    for (const element of scene.elementsById.values()) {
      if (element.kind === 'node') nodes.push(element);
      else if (element.kind === 'edge') edges.push(element);
    }
    nodes.sort((a, b) => depthOf(a) - depthOf(b));

    for (const edge of edges) {
      const g = this.drawEdge(edge);
      append(connectionsLayer, g);
      if (edge.id) this.graphicsById.set(edge.id, g);
    }
    for (const node of nodes) {
      const g = this.drawShape(node);
      append(shapesLayer, g);
      if (node.id) this.graphicsById.set(node.id, g);
    }
  }

  /**
   * Re-draw one element's graphics from its CURRENT scene geometry, swapping the new
   * `<g>` in at the old one's z-position so layering is preserved. Returns the new
   * group, or `undefined` when the element was never rendered. Used for live drag
   * feedback (`interaction/drag.ts`); marker/`selected` classes are re-applied by
   * `Selection.restoreMarkers`.
   */
  redraw(element: SceneElement): SVGGElement | undefined {
    const old = this.graphicsById.get(element.id);
    const parent = old?.parentNode;
    if (!old || !parent) return undefined;
    const g = element.kind === 'node' ? this.drawShape(element) : this.drawEdge(element);
    parent.replaceChild(g, old);
    this.graphicsById.set(element.id, g);
    return g;
  }

  /**
   * Drop a deleted element's graphics: detach its `<g>` from the layer it was
   * mounted in and forget it. Returns whether anything was rendered for that id.
   */
  erase(id: string): boolean {
    const g = this.graphicsById.get(id);
    if (!g) return false;
    remove(g);
    this.graphicsById.delete(id);
    return true;
  }

  /** Draw one node as a translated `<g>`; returns the group. */
  drawShape(node: SceneNode): SVGGElement {
    const g = group(node.x, node.y, {
      class: 'sf-shape',
      'data-element-id': node.id,
      'data-element-type': node.type,
      // Contents of a collapsed sub-process still exist in the document; they are
      // simply not drawn while their container hides them (`model/expand.ts`).
      display: isHiddenByCollapse(node) ? 'none' : null,
    });
    const style = styleOf(node);
    const category = categoryOf(node.type);
    const name = typeof prop(node.businessObject, 'name') === 'string'
      ? (prop(node.businessObject, 'name') as string)
      : '';

    switch (category) {
      case 'event':
        drawEvent(g, node.width, node.height, style, eventKind(node));
        drawExternalLabel(g, node, name, style.stroke, node.label);
        break;
      case 'task':
        drawTask(g, node.width, node.height, style, THICK_ACTIVITY.has(node.type));
        this.drawTypeIcon(g, node, style.stroke);
        this.drawMarkers(g, node, style.stroke);
        drawInternalLabel(g, node, name, style.stroke);
        break;
      case 'gateway':
        drawDiamond(g, node.width, node.height, style);
        this.drawGatewayGlyph(g, node, style.stroke);
        drawExternalLabel(g, node, name, style.stroke, node.label);
        break;
      case 'data':
        if (node.type === BPMN.DataStoreReference) drawDataStore(g, node.width, node.height, style);
        else drawDataObject(g, node.width, node.height, style);
        drawExternalLabel(g, node, name, style.stroke, node.label);
        break;
      case 'choreography':
        this.drawChoreography(g, node, style, name);
        break;
      case 'group':
        drawGroup(g, node.width, node.height, style);
        break;
      case 'annotation':
        drawTextAnnotation(g, node.width, node.height, style);
        this.drawAnnotationText(g, name, style.stroke);
        break;
      case 'participant':
        drawParticipant(g, node.width, node.height, style);
        this.drawParticipantLabel(g, node, name, style.stroke);
        break;
      default:
        // Unknown vocabulary: draw a neutral rect so its bounds are still visible.
        drawTask(g, node.width, node.height, { ...style, fill: 'none' });
        drawInternalLabel(g, node, name, style.stroke);
        break;
    }
    return g;
  }

  private drawTypeIcon(g: SVGGElement, node: SceneNode, color: string): void {
    // The top-left type glyph; a placeholder unless a resolver is injected.
    const key = toLocalName(node.type);
    if (key && key !== 'Task') {
      drawIcon(g, key, 5, 5, 22, color, this.iconResolver, node.businessObject);
    }
  }

  private drawGatewayGlyph(g: SVGGElement, node: SceneNode, color: string): void {
    const glyph = GATEWAY_GLYPH[node.type];
    if (!glyph) return;
    // Exclusive marker only shows when the DI flags it (BPMNShape.isMarkerVisible).
    if (node.type === BPMN.ExclusiveGateway && node.isMarkerVisible === false) return;
    const text = create('text', {
      x: node.width / 2,
      y: node.height / 2,
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
      'font-size': 20,
      fill: color,
      'stroke-width': 0,
    });
    text.textContent = glyph;
    append(g, text);
  }

  /**
   * Bottom-centre activity markers (design §2), the same set and order the modeler's
   * bpmn-js renderer draws (`draw/Renderer.ts` `drawMarkers`) so a diagram reads the
   * same on either backend. Each marker is drawn by KEY; the injected resolver turns
   * the key into a glyph.
   */
  private drawMarkers(g: SVGGElement, node: SceneNode, color: string): void {
    const markers: string[] = [];
    const bo = node.businessObject;

    const checklist = getAttribute(bo, 'checklist');
    if (Array.isArray(checklist) && checklist.length > 0) markers.push('checklist');
    if (isDataOperationActivity(bo)) markers.push('function');
    // A collapsed sub-process is drawn as a plain activity box carrying the ⊞ that
    // says "there is more inside" (design §2 markers).
    if (isCollapsed(node)) markers.push('subprocess');
    if (node.type === 'bpmn:AdHocSubProcess') markers.push('adhoc');
    if (prop(bo, 'isForCompensation') === true) markers.push('compensation');

    const loop = prop(bo, 'loopCharacteristics') as ModdleObject | undefined;
    if (loop) {
      const sequential = prop(loop, 'isSequential');
      if (sequential === true) markers.push('sequential');
      else if (sequential === false) markers.push('parallel');
      else markers.push('loop');
    }
    if (markers.length === 0) return;

    const MARKER_SIZE = 20;
    const gap = 4;
    const markerY = node.height - MARKER_SIZE - gap;
    const offsetX = (node.width - markers.length * MARKER_SIZE) / 2;
    markers.forEach((marker, i) => {
      // The marker KEY, not its glyph: `drawIcon` resolves it through the injected
      // resolver first and only then falls back to `MARKER_ICONS[key]` (⊞, ~) — handing
      // it the glyph skipped both and drew a `?` placeholder.
      drawIcon(g, marker, offsetX + i * MARKER_SIZE, markerY, MARKER_SIZE, color, this.iconResolver, node.businessObject);
    });
  }

  private drawAnnotationText(g: SVGGElement, name: string, color: string): void {
    if (!name) return;
    const text = create('text', {
      x: 6,
      y: 16,
      'font-size': 12,
      'font-family': 'system-ui, sans-serif',
      fill: color,
      'stroke-width': 0,
    });
    text.textContent = name.length > 40 ? name.slice(0, 39) + '…' : name;
    append(g, text);
  }

  private drawParticipantLabel(g: SVGGElement, node: SceneNode, name: string, color: string): void {
    if (!name) return;
    // Vertical label in the left title band.
    const text = create('text', {
      x: 15,
      y: node.height / 2,
      transform: `rotate(-90, 15, ${node.height / 2})`,
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
      'font-size': 12,
      'font-family': 'system-ui, sans-serif',
      fill: color,
      'stroke-width': 0,
    });
    text.textContent = name;
    append(g, text);
  }

  /** Choreography task: two participant bands + middle name band (ported from draw/choreography.ts). */
  private drawChoreography(g: SVGGElement, node: SceneNode, style: ShapeStyle, name: string): void {
    const { width, height } = node;
    const bandHeight = choreographyBandHeight(height);
    const { stroke, fill } = style;
    const receiving = '#ededed';
    const bands = readChoreographyBands(node.businessObject);

    append(g, create('rect', {
      x: 0, y: 0, rx: CORNER_RADIUS, ry: CORNER_RADIUS, width, height,
      fill, stroke, 'stroke-width': 2,
      'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    }));

    const topFill = bands.initiator === 'top' ? fill : receiving;
    const bottomFill = bands.initiator === 'bottom' ? fill : receiving;
    // `data-band` names the two participant bands so their fills (which encode who
    // initiates) can be read back without depending on child order.
    append(g, create('path', {
      d: bandPath(width, bandHeight, height, 'top'),
      fill: topFill, stroke: 'none', 'data-band': 'top',
    }));
    append(g, create('path', {
      d: bandPath(width, bandHeight, height, 'bottom'),
      fill: bottomFill, stroke: 'none', 'data-band': 'bottom',
    }));

    for (const y of [bandHeight, height - bandHeight]) {
      append(g, create('line', { x1: 0, y1: y, x2: width, y2: y, stroke, 'stroke-width': 1 }));
    }
    // Redraw the outer border on top of the band fills.
    append(g, create('rect', {
      x: 0, y: 0, rx: CORNER_RADIUS, ry: CORNER_RADIUS, width, height,
      fill: 'none', stroke, 'stroke-width': 2,
    }));

    drawBandText(g, bands.top, width / 2, bandHeight / 2, width, stroke, 11, '400');
    drawBandText(g, bands.bottom, width / 2, height - bandHeight / 2, width, stroke, 11, '400');
    if (name) {
      drawInternalLabel(g, { ...node, height: height - 2 * bandHeight, y: node.y + bandHeight } as SceneNode, name, stroke);
    }
  }

  /** Draw one edge as a polyline through its waypoints, with a flow-typed arrowhead. */
  drawEdge(edge: SceneEdge): SVGGElement {
    const g = group(0, 0, {
      class: 'sf-connection',
      'data-element-id': edge.id,
      'data-element-type': edge.type,
      display: isHiddenByCollapse(edge) ? 'none' : null,
    });
    const points = edge.waypoints.map((p) => `${p.x},${p.y}`).join(' ');
    const stroke = colorAttr(edge.di, ['stroke', 'border-color', 'bioc:stroke', 'color:border-color']) ?? DEFAULT_STROKE;

    const dashed = edge.type === BPMN.MessageFlow
      || edge.type === BPMN.Association
      || edge.type === 'bpmn:DataInputAssociation'
      || edge.type === 'bpmn:DataOutputAssociation';

    const line = create('polyline', {
      points,
      fill: 'none',
      stroke,
      'stroke-width': 2,
      'stroke-linejoin': 'round',
      'stroke-linecap': 'round',
      'stroke-dasharray': dashed ? (edge.type === BPMN.MessageFlow ? '10,8' : '2,6') : null,
      'marker-end': `url(#${markerIdFor(edge.type)})`,
    });
    append(g, line);
    const name = prop(edge.businessObject, 'name');
    if (typeof name === 'string' && name) drawEdgeLabel(g, edge, name, stroke, edge.label);
    return g;
  }
}

/** Depth in the containment tree (ancestors-first z-order). */
function depthOf(node: SceneNode): number {
  let depth = 0;
  let parent = node.parent;
  const guard = new Set<SceneNode>();
  while (parent && !guard.has(parent)) {
    guard.add(parent);
    depth += 1;
    parent = parent.parent;
  }
  return depth;
}

/** The arrowhead marker id for a flow type (defined once in the canvas `<defs>`). */
export function markerIdFor(type: string): string {
  if (type === BPMN.MessageFlow) return 'sf-arrow-message';
  if (EDGE_TYPES.has(type) && type !== BPMN.SequenceFlow) return 'sf-arrow-open';
  return 'sf-arrow-sequence';
}


/** Install the arrowhead marker `<defs>` once into `defs`. */
export function ensureArrowMarkers(defs: SVGDefsElement): void {
  if (defs.querySelector('#sf-arrow-sequence')) return;
  defs.appendChild(makeMarker('sf-arrow-sequence', 'filled'));
  defs.appendChild(makeMarker('sf-arrow-message', 'open'));
  defs.appendChild(makeMarker('sf-arrow-open', 'open'));
}

function makeMarker(id: string, kind: 'filled' | 'open'): SVGMarkerElement {
  const marker = create('marker', {
    id,
    markerWidth: 12,
    markerHeight: 12,
    refX: 9,
    refY: 5,
    orient: 'auto',
    markerUnits: 'userSpaceOnUse',
  }) as SVGMarkerElement;
  const path = create('path', {
    d: 'M1,1 L10,5 L1,9 Z',
    fill: kind === 'filled' ? 'context-stroke' : 'none',
    stroke: 'context-stroke',
    'stroke-width': 1,
  });
  append(marker, path);
  return marker;
}

/** Re-export tiny helpers used by callers wiring the renderer into layers. */
export { attr, remove };
