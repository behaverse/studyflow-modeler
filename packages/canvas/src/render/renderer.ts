/**
 * Draws the scene: one `<g>` per node, edge and label in the elements layer, in
 * z-rank order. Icons come from the host's resolver.
 */

import { BPMN } from '@core/constants.ts';
import { effectiveAttribute } from '@core/document/index.ts';
import { getAttribute, StudyflowElement } from '@core/element/index.ts';
import { toLocalName } from '@core/naming.ts';
import { getCatalog } from '@core/notation/index.ts';

import { isTypedChoreography, readChoreographyBands } from '@canvas/model/choreography.ts';
import { normalizeColor } from '@canvas/model/color.ts';
import { DATA_INPUT_ASSOCIATION, DATA_OUTPUT_ASSOCIATION, isDataAssociationType } from '@canvas/model/dataAssociation.ts';
import { nameOf, prop } from '@canvas/model/moddle.ts';
import type { ModdleObject, Point, Scene, SceneEdge, SceneElement, SceneLabel, SceneNode } from '@canvas/model/scene.ts';
import { isHidden, zRankOf } from '@canvas/model/tree.ts';
import { drawIcon, drawIconText, drawSvgPaths, SVG_ICON_PATHS, type IconResolver } from '@canvas/render/icons.ts';
import { EDGE_CORNER_RADIUS, lineJumps, type Span } from '@canvas/render/jumps.ts';
import {
  alignedX,
  CHROME,
  drawBandText,
  drawInternalLabel,
  drawLabel,
  fit,
  FONT,
  LINE_HEIGHT,
  styled,
  textLine,
  WEIGHT,
  wrap,
} from '@canvas/render/labels.ts';
import {
  activityMarkers,
  bandPath,
  categoryOf,
  choreographyBandHeight,
  CORNER_RADIUS,
  dataStoreRim,
  drawDataObject,
  drawDataStore,
  drawDiamond,
  drawEvent,
  drawGroup,
  drawParticipant,
  drawTask,
  drawTextAnnotation,
  participantInstances,
  PARTICIPANT_BAND,
  STROKE_WIDTH,
  type EventKind,
  type ShapeStyle,
} from '@canvas/render/shapes.ts';
import { append, attr, create, group, remove } from '@canvas/render/svg.ts';
import { isDataStore } from '@canvas/rules/rules.ts';
import { INK } from '@canvas/view/theme.ts';

const THICK_ACTIVITY = new Set<string>([BPMN.CallActivity, 'bpmn:Transaction']);
const EDGE_TYPES = new Set<string>([
  BPMN.SequenceFlow, BPMN.MessageFlow, BPMN.Association, DATA_INPUT_ASSOCIATION, DATA_OUTPUT_ASSOCIATION,
]);

/**
 * The marker row a lane leaves to the container it divides: `CHROME.foot` when that container draws
 * bottom-centre markers and the lane reaches its bottom edge, else nothing. Only a sub-process asks
 * for it; a pool marks its multiplicity in its title band, which no lane covers.
 */
function footRoom(node: SceneNode): number {
  const owner = node.parent;
  if (node.type !== BPMN.Lane || !owner || activityMarkers(owner).length === 0) return 0;
  return node.y + node.height >= owner.y + owner.height - 1 ? CHROME.foot : 0;
}

/** The type glyph, tucked into the top-left corner; its row is what `CHROME.head` keeps clear. */
const TYPE_ICON = { x: 3, y: 3, size: 24 };
const MARKER_SIZE = 16;
/** The gap the pool's title-band marker keeps from the band's foot, and from the name above it. */
const BAND_MARKER_GAP = 6;
const OVERLAY_ICON_SIZE = 16;
/** Badges share the glyph row's centre line. */
const OVERLAY_ICON_Y = TYPE_ICON.y + (TYPE_ICON.size - OVERLAY_ICON_SIZE) / 2;
const EVENT_ICON_SIZE = 20;
const DATA_ICON_SIZE = 20;
const ANNOTATION_PADDING = 7;

/** The value of the attribute a type's `meta.glyph` names, drawn as text over the type icon; a custom icon replaces it. */
function iconGlyph(bo: ModdleObject | undefined): string | undefined {
  const element = StudyflowElement.fromBusinessObject(bo);
  const name = getCatalog().getType(element.extensionType)?.meta?.glyph;
  if (typeof name !== 'string') return undefined;
  if ((element.extension ?? element.businessObject)?.get?.('studyflow:icon')) return undefined;
  // What a run reads: the value the Parameters wired into the task set, else its own.
  const value = effectiveAttribute(bo, name);
  if (typeof value !== 'string' || !value) return undefined;
  return value.toUpperCase();
}

/** Icon keys of schema attributes declaring `meta.icon` that hold a value on `bo`. */
function overlayIconsOf(bo: ModdleObject | undefined): string[] {
  if (!bo) return [];
  let catalog: ReturnType<typeof getCatalog>;
  try {
    catalog = getCatalog();
  } catch {
    return [];
  }
  const typeName = StudyflowElement.fromBusinessObject(bo).extensionType ?? bo.$type;
  const keys: string[] = [];
  for (const attr of catalog.instanceAttributesOf(typeName)) {
    const icon = attr.meta?.icon;
    if (typeof icon === 'string' && icon && getAttribute(bo, attr.name)) keys.push(icon);
  }
  return keys;
}

/** The icon of a data store's `format` literal, if the schema declares one. */
function formatIconOf(bo: ModdleObject | undefined): string | undefined {
  const format = getAttribute(bo, 'format');
  if (typeof format !== 'string' || !format) return undefined;
  let catalog: ReturnType<typeof getCatalog>;
  try {
    catalog = getCatalog();
  } catch {
    return undefined;
  }
  const icon = catalog.enumOf('DatasetFormatEnum')?.literals.find((l) => l.value === format)?.icon;
  return typeof icon === 'string' && icon ? icon : undefined;
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

function darken(color: string, amount = 0.12): string {
  let hex: string | undefined;
  try {
    hex = normalizeColor(color);
  } catch {
    return color;
  }
  if (!hex) return color;
  const value = Number.parseInt(hex.slice(1), 16);
  const channels = [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]
    .map((c) => Math.max(0, Math.min(255, Math.round(c * (1 - amount)))));
  return `#${channels.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

export interface RendererOptions {
  iconResolver?: IconResolver;
  /** Maps a raw `name` to the text drawn (placeholder resolution); the model keeps the raw name. */
  labelText?: (businessObject: ModdleObject | undefined, name: string) => string;
}

export class Renderer {
  readonly graphicsById = new Map<string, SVGGElement>();
  /** The drill-down scope, which decides what is drawn hidden. */
  scope?: SceneNode;
  private scene?: Scene;
  private readonly iconResolver?: IconResolver;
  private readonly labelText?: RendererOptions['labelText'];

  constructor(options: RendererOptions = {}) {
    this.iconResolver = options.iconResolver;
    this.labelText = options.labelText;
  }

  private nameOf(businessObject: ModdleObject | undefined): string {
    const name = nameOf(businessObject);
    return this.labelText ? this.labelText(businessObject, name) : name;
  }

  renderScene(scene: Scene, layer: SVGElement): void {
    this.graphicsById.clear();
    this.scope = scene.scope;
    this.scene = scene;
    const elements = [...scene.elementsById.values()].sort((a, b) => zRankOf(a) - zRankOf(b));
    for (const element of elements) {
      const g = this.draw(element);
      append(layer, g);
      if (element.id) this.graphicsById.set(element.id, g);
    }
  }

  draw(element: SceneElement): SVGGElement {
    if (element.kind === 'node') return this.drawShape(element);
    if (element.kind === 'edge') return this.drawEdge(element);
    return this.drawLabelElement(element);
  }

  /** Re-draw one element in place; `undefined` when it was never drawn. */
  redraw(element: SceneElement): SVGGElement | undefined {
    const old = this.graphicsById.get(element.id);
    const parent = old?.parentNode;
    if (!old || !parent) return undefined;
    const g = this.draw(element);
    parent.replaceChild(g, old);
    this.graphicsById.set(element.id, g);
    return g;
  }

  erase(id: string): boolean {
    const g = this.graphicsById.get(id);
    if (!g) return false;
    remove(g);
    this.graphicsById.delete(id);
    return true;
  }

  drawShape(node: SceneNode): SVGGElement {
    const g = group(node.x, node.y, {
      class: 'sf-shape',
      'data-element-id': node.id,
      'data-element-type': node.type,
      display: isHidden(node, this.scope) ? 'none' : null,
    });
    const style: ShapeStyle = { stroke: node.stroke ?? INK.stroke, fill: node.fill ?? INK.fill };
    const iconColor = node.stroke ?? INK.muted;
    const name = this.nameOf(node.businessObject);

    switch (categoryOf(node.type)) {
      case 'event': {
        const kind = eventKind(node);
        drawEvent(g, node.width, node.height, style, kind);
        this.drawEventIcons(g, node, style.stroke, kind);
        break;
      }
      case 'task': {
        drawTask(g, node.width, node.height, style, THICK_ACTIVITY.has(node.type));
        const scene = iconGlyph(node.businessObject);
        this.drawTypeIcon(g, node, iconColor);
        drawIconText(g, scene, TYPE_ICON.x, TYPE_ICON.y, TYPE_ICON.size, style.stroke);
        this.drawMarkers(g, node, iconColor);
        this.drawOverlayIcons(g, node, iconColor);
        drawInternalLabel(g, node, name, INK.text);
        break;
      }
      case 'gateway':
        drawDiamond(g, node.width, node.height, style);
        this.drawGatewayGlyph(g, node, style.stroke);
        this.drawOverlayIcons(g, node, iconColor);
        break;
      case 'data':
        if (isDataStore(node.type)) drawDataStore(g, node.width, node.height, style);
        else drawDataObject(g, node.width, node.height, style);
        this.drawDataIcons(g, node, iconColor);
        this.drawOverlayIcons(g, node, iconColor);
        break;
      case 'choreography': {
        const scene = iconGlyph(node.businessObject);
        const typed = isTypedChoreography(node.businessObject);
        if (!typed || (prop(node.businessObject, 'participantRef') as unknown[] | undefined)?.length) {
          // Bands name the parties; the type glyph sits in the middle band, where the task's own name is.
          this.drawChoreography(g, node, style, name);
          const inner = append(g, group(0, choreographyBandHeight(node.height)));
          this.drawTypeIcon(inner, node, iconColor);
          drawIconText(inner, scene, TYPE_ICON.x, TYPE_ICON.y, TYPE_ICON.size, style.stroke);
        } else {
          // A typed one (a cognitive task) naming no party: the study's own participant takes it, and it is drawn
          // as the plain task it reads as. A plain choreography task keeps its default bands, which are its point.
          drawTask(g, node.width, node.height, style, false);
          this.drawTypeIcon(g, node, iconColor);
          drawIconText(g, scene, TYPE_ICON.x, TYPE_ICON.y, TYPE_ICON.size, style.stroke);
          drawInternalLabel(g, node, name, INK.text);
        }
        this.drawOverlayIcons(g, node, iconColor);
        break;
      }
      case 'group':
        drawGroup(g, node.width, node.height, style);
        this.drawGroupLabel(g, node, INK.muted);
        break;
      case 'annotation': {
        drawTextAnnotation(g, node.width, node.height, style);
        const text = prop(node.businessObject, 'text');
        this.drawAnnotationText(g, node, (typeof text === 'string' && text) || name, INK.text);
        break;
      }
      case 'participant': {
        // A lane is painted after the container it divides, so it stops above that container's marker row.
        drawParticipant(g, node.width, node.height - footRoom(node), style);
        this.drawParticipantLabel(g, node, name, INK.text, this.drawBandMarker(g, node, iconColor));
        break;
      }
      default:
        drawTask(g, node.width, node.height, { ...style, fill: 'none' });
        drawInternalLabel(g, node, name, INK.text);
        break;
    }
    return g;
  }

  drawEdge(edge: SceneEdge): SVGGElement {
    const g = group(0, 0, {
      class: 'sf-connection',
      'data-element-id': edge.id,
      'data-element-type': edge.type,
      display: isHidden(edge, this.scope) ? 'none' : null,
    });
    append(g, create('path', {
      class: 'sf-connection-line',
      d: roundedPathData(edge.waypoints, EDGE_CORNER_RADIUS, this.jumpsOf(edge)),
      'data-waypoints': edge.waypoints.map((p) => `${p.x},${p.y}`).join(' '),
      fill: 'none',
      stroke: edge.stroke ?? INK.stroke,
      'stroke-width': STROKE_WIDTH,
      'stroke-linejoin': 'round',
      'stroke-linecap': 'round',
      'stroke-dasharray': edgeDashArray(edge.type),
      'marker-end': markerEndFor(edge.type, edge.businessObject),
      'marker-start': markerStartFor(edge.type, isDefaultFlow(edge)),
    }));
    return g;
  }

  /** Re-cut every drawn edge's line jumps: a crossing belongs to two edges, and only one of them was redrawn. */
  refreshJumps(): void {
    for (const element of this.scene?.elementsById.values() ?? []) {
      if (element.kind !== 'edge') continue;
      const line = this.graphicsById.get(element.id)?.querySelector('.sf-connection-line');
      line?.setAttribute('d', roundedPathData(element.waypoints, EDGE_CORNER_RADIUS, this.jumpsOf(element)));
    }
  }

  private jumpsOf(edge: SceneEdge): Span[][] {
    const below: Point[][] = [];
    const above: Point[][] = [];
    let seen = false;
    for (const element of this.scene?.elementsById.values() ?? []) {
      if (element === edge) seen = true;
      else if (element.kind === 'edge' && !isHidden(element, this.scope)) (seen ? above : below).push(element.waypoints);
    }
    return lineJumps(edge.waypoints, below, above);
  }

  drawLabelElement(label: SceneLabel): SVGGElement {
    const g = drawLabel(label, this.nameOf(label.businessObject), label.owner.stroke ?? INK.muted);
    if (isHidden(label, this.scope)) g.setAttribute('display', 'none');
    return g;
  }

  private drawTypeIcon(g: SVGGElement, node: SceneNode, color: string): void {
    const key = toLocalName(node.type);
    if (!key) return;
    // A plain task has no glyph of its own; it only gets one when the host names one.
    if (key === 'Task' && !this.iconResolver?.(key, node.businessObject)) return;
    drawIcon(g, key, TYPE_ICON.x, TYPE_ICON.y, TYPE_ICON.size, color, this.iconResolver, node.businessObject);
  }

  private drawEventIcons(g: SVGGElement, node: SceneNode, color: string, kind?: string): void {
    const resolver = this.iconResolver;
    if (!resolver) return;
    const bo = node.businessObject;
    const x = (node.width - EVENT_ICON_SIZE) / 2;
    const y = (node.height - EVENT_ICON_SIZE) / 2;
    const defs = prop(bo, 'eventDefinitions');
    const def = Array.isArray(defs) ? (defs[0] as ModdleObject | undefined) : undefined;
    let defKey = def ? toLocalName(def.$type) : undefined;
    // BPMN draws a throwing (end) event's symbol filled: the host may name that variant under `<definition>:end`.
    if (defKey && kind === 'end' && resolver(`${defKey}:end`, def)) defKey = `${defKey}:end`;
    let centreTaken = false;
    if (defKey && resolver(defKey, def)) {
      drawIcon(g, defKey, x, y, EVENT_ICON_SIZE, color, resolver, def);
      centreTaken = true;
    } else {
      // No definition: the host may still name a glyph for the element itself — a
      // schema event type's icon (`meta.icon` on an `IntermediateCatchEvent` wrapper).
      const typeKey = toLocalName(node.type);
      if (typeKey && resolver(typeKey, bo)) {
        drawIcon(g, typeKey, x, y, EVENT_ICON_SIZE, color, resolver, bo);
        centreTaken = true;
      }
    }
    // Attribute badges (consent form, redirect) take the centre of a plain event;
    // once a glyph sits there they move to the top-right rim, like on other shapes.
    if (centreTaken) this.drawOverlayIcons(g, node, color, -2, -2);
    else {
      for (const key of overlayIconsOf(bo)) {
        if (resolver(key)) drawIcon(g, key, x, y, EVENT_ICON_SIZE, color, resolver);
      }
    }
  }

  /** Schema-attribute badges in the top-right corner, stacking leftward. */
  private drawOverlayIcons(g: SVGGElement, node: SceneNode, color: string, inset = 6, y = OVERLAY_ICON_Y): void {
    const resolver = this.iconResolver;
    if (!resolver) return;
    let x = node.width - OVERLAY_ICON_SIZE - inset;
    for (const key of overlayIconsOf(node.businessObject)) {
      if (!resolver(key)) continue;
      drawIcon(g, key, x, y, OVERLAY_ICON_SIZE, color, resolver);
      x -= OVERLAY_ICON_SIZE + 4;
    }
  }

  private drawDataIcons(g: SVGGElement, node: SceneNode, color: string): void {
    const resolver = this.iconResolver;
    if (!resolver) return;
    const key = (isDataStore(node.type) && formatIconOf(node.businessObject)) || toLocalName(node.type);
    if (!key) return;
    // A data store's glyph is centred on the cylinder's body, below the rim.
    const cy = isDataStore(node.type) ? (2 * dataStoreRim(node.height) + node.height) / 2 : node.height / 2;
    const def = SVG_ICON_PATHS[key];
    if (def) {
      drawSvgPaths(g, def, 4, cy - 7, node.width - 8, 14, color, key);
      return;
    }
    if (!resolver(key, node.businessObject)) return;
    const size = DATA_ICON_SIZE;
    drawIcon(g, key, (node.width - size) / 2, cy - size / 2, size, color, resolver, node.businessObject);
  }

  private drawGatewayGlyph(g: SVGGElement, node: SceneNode, color: string): void {
    const key = toLocalName(node.type);
    const cx = node.width / 2;
    const cy = node.height / 2;
    if (key && this.iconResolver?.(key, node.businessObject)) {
      drawIcon(g, key, cx - 10, cy - 10, 20, color, this.iconResolver, node.businessObject);
      return;
    }
    const line = (d: string): void => {
      append(g, create('path', { d, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linecap': 'round' }));
    };
    switch (node.type) {
      case BPMN.ExclusiveGateway:
        if (node.isMarkerVisible !== false) line(`M${cx - 6},${cy - 6} L${cx + 6},${cy + 6} M${cx + 6},${cy - 6} L${cx - 6},${cy + 6}`);
        break;
      case BPMN.ParallelGateway:
        line(`M${cx - 8},${cy} L${cx + 8},${cy} M${cx},${cy - 8} L${cx},${cy + 8}`);
        break;
      case BPMN.InclusiveGateway:
        append(g, create('circle', { cx, cy, r: 8, fill: 'none', stroke: color, 'stroke-width': 2 }));
        break;
      case BPMN.ComplexGateway:
        line(`M${cx - 7},${cy} L${cx + 7},${cy} M${cx},${cy - 7} L${cx},${cy + 7} M${cx - 5},${cy - 5} L${cx + 5},${cy + 5} M${cx + 5},${cy - 5} L${cx - 5},${cy + 5}`);
        break;
      case BPMN.EventBasedGateway:
        append(g, create('circle', { cx, cy, r: 9, fill: 'none', stroke: color, 'stroke-width': 1.5 }));
        append(g, create('circle', { cx, cy, r: 6, fill: 'none', stroke: color, 'stroke-width': 1.5 }));
        break;
      default:
        break;
    }
  }

  /** Bottom-centre activity markers, in the row `CHROME.foot` keeps clear. */
  private drawMarkers(g: SVGGElement, node: SceneNode, color: string): void {
    const bo = node.businessObject;
    const markers = activityMarkers(node);
    if (markers.length === 0) return;
    const gap = 4;
    const y = node.height - MARKER_SIZE - 4;
    const startX = (node.width - markers.length * MARKER_SIZE - (markers.length - 1) * gap) / 2;
    markers.forEach((marker, i) => {
      drawIcon(g, marker, startX + i * (MARKER_SIZE + gap), y, MARKER_SIZE, color, this.iconResolver, bo);
    });
  }

  /**
   * A pool of several participant instances marks them at the foot of its own title band — the strip the
   * rotated name runs up, which no lane reaches. BPMN puts participant multiplicity at the pool's bottom
   * centre, where it sits under the bottom lane and reads as that lane's, and lanes carry no markers of
   * their own to tell it apart. The bars stay upright, so it is the parallel marker a step carries,
   * and `×N` under them — `participantMultiplicity/@maximum` — says how many instances that is.
   * Returns the band length it takes, which the name gives up.
   */
  private drawBandMarker(g: SVGGElement, node: SceneNode, color: string): number {
    const instances = participantInstances(node.businessObject);
    if (node.type !== BPMN.Participant || instances < 2) return 0;
    const centre = Math.min(PARTICIPANT_BAND, node.width) / 2;
    const y = node.height - MARKER_SIZE - LINE_HEIGHT - BAND_MARKER_GAP;
    drawIcon(g, 'parallel', centre - MARKER_SIZE / 2, y, MARKER_SIZE, color, this.iconResolver, node.businessObject);
    append(g, textLine(`×${instances}`, centre, y + MARKER_SIZE + LINE_HEIGHT / 2,
      { fontSize: FONT.band, color: INK.text, weight: WEIGHT.internal }));
    return MARKER_SIZE + LINE_HEIGHT + 2 * BAND_MARKER_GAP;
  }

  /** A group's caption lives on its `bpmn:CategoryValue`, centred on the top edge. */
  private drawGroupLabel(g: SVGGElement, node: SceneNode, color: string): void {
    const categoryValue = prop(node.businessObject, 'categoryValueRef');
    const value = categoryValue && typeof categoryValue === 'object' ? prop(categoryValue as ModdleObject, 'value') : undefined;
    if (typeof value !== 'string' || !value) return;
    drawBandText(g, value, node.width / 2, 10, node.width, color, FONT.external, WEIGHT.external, node.font);
  }

  private drawAnnotationText(g: SVGGElement, node: SceneNode, content: string, color: string): void {
    if (!content) return;
    const width = Math.max(1, node.width - 2 * ANNOTATION_PADDING);
    const lines = wrap(content, width + 8, FONT.annotation, 20);
    const at = alignedX(ANNOTATION_PADDING, width, node.font?.align ?? 'left');
    const style = styled({ fontSize: FONT.annotation, color, anchor: at.anchor }, node.font);
    lines.forEach((line, i) => append(g, textLine(line, at.x, ANNOTATION_PADDING + (i + 0.5) * LINE_HEIGHT, style)));
  }

  /** The name, rotated up the title band and centred in the length the band's marker leaves it. */
  private drawParticipantLabel(g: SVGGElement, node: SceneNode, name: string, color: string, markerRoom = 0): void {
    if (!name) return;
    const x = PARTICIPANT_BAND / 2;
    const room = node.height - markerRoom;
    const y = room / 2;
    const text = textLine(markerRoom > 0 ? fit(name, room, FONT.internal) : name, x, y,
      styled({ fontSize: FONT.internal, color, weight: WEIGHT.internal }, node.font));
    attr(text, { transform: `rotate(-90, ${x}, ${y})`, 'dominant-baseline': 'central' });
    append(g, text);
  }

  /** Two participant bands around the task's own name band. */
  private drawChoreography(g: SVGGElement, node: SceneNode, style: ShapeStyle, name: string): void {
    const { width, height } = node;
    const bandHeight = choreographyBandHeight(height);
    const { stroke, fill } = style;
    const bands = readChoreographyBands(node.businessObject);
    const receivingFill = node.fill ? darken(node.fill) : INK.band;
    const topFill = bands.initiator === 'top' ? INK.fill : receivingFill;
    const bottomFill = bands.initiator === 'bottom' ? INK.fill : receivingFill;

    append(g, create('rect', { x: 0, y: 0, rx: CORNER_RADIUS, ry: CORNER_RADIUS, width, height, fill, stroke: 'none' }));
    append(g, create('path', { d: bandPath(width, bandHeight, height, 'top'), fill: topFill, stroke: 'none', 'data-band': 'top' }));
    append(g, create('path', { d: bandPath(width, bandHeight, height, 'bottom'), fill: bottomFill, stroke: 'none', 'data-band': 'bottom' }));
    for (const y of [bandHeight, height - bandHeight]) {
      append(g, create('line', { x1: 0, y1: y, x2: width, y2: y, stroke, 'stroke-width': 1 }));
    }
    append(g, create('rect', {
      x: 0, y: 0, rx: CORNER_RADIUS, ry: CORNER_RADIUS, width, height, fill: 'none', stroke, 'stroke-width': STROKE_WIDTH,
    }));
    drawBandText(g, bands.top, width / 2, bandHeight / 2, width, INK.text);
    drawBandText(g, bands.bottom, width / 2, height - bandHeight / 2, width, INK.text);
    if (name) {
      const inner = append(g, group(0, bandHeight));
      drawInternalLabel(inner, { ...node, height: height - 2 * bandHeight } as SceneNode, name, INK.text);
    }
  }
}

/**
 * Straight runs joined by quarter-arc corners, hopping over `jumps` (per segment, from
 * `lineJumps`) with a semicircle; the waypoints stay the geometry.
 */
export function roundedPathData(
  waypoints: readonly Point[], radius = EDGE_CORNER_RADIUS, jumps: readonly (readonly Span[])[] = [],
): string {
  if (waypoints.length === 0) return '';
  let d = `M ${round(waypoints[0].x)} ${round(waypoints[0].y)}`;
  for (let i = 0; i < waypoints.length - 1; i += 1) {
    const from = waypoints[i];
    const to = waypoints[i + 1];
    const dir = direction(from, to);
    // A jump bumps upward on a horizontal run (rightward on a vertical one): clockwise when heading right or down.
    const sweep = dir.x < 0 || (dir.x === 0 && dir.y < 0) ? 0 : 1;
    for (const [start, end] of jumps[i] ?? []) {
      const r = (end - start) / 2;
      d += ` L ${round(from.x + dir.x * start)} ${round(from.y + dir.y * start)}`
        + ` A ${round(r)} ${round(r)} 0 0 ${sweep} ${round(from.x + dir.x * end)} ${round(from.y + dir.y * end)}`;
    }
    const next = waypoints[i + 2];
    if (!next) break;
    const r = Math.min(radius, Math.hypot(to.x - from.x, to.y - from.y) / 2, Math.hypot(next.x - to.x, next.y - to.y) / 2);
    const outDir = direction(to, next);
    const cross = dir.x * outDir.y - dir.y * outDir.x;
    if (r <= 0 || Math.abs(cross) < 1e-6) {
      d += ` L ${round(to.x)} ${round(to.y)}`;
      continue;
    }
    d += ` L ${round(to.x - dir.x * r)} ${round(to.y - dir.y * r)}`
      + ` A ${round(r)} ${round(r)} 0 0 ${cross > 0 ? 1 : 0} ${round(to.x + outDir.x * r)} ${round(to.y + outDir.y * r)}`;
  }
  if (waypoints.length === 1) return d;
  const last = waypoints[waypoints.length - 1];
  return `${d} L ${round(last.x)} ${round(last.y)}`;
}

function direction(a: Point, b: Point): Point {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  return length < 1e-6 ? { x: 0, y: 0 } : { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function edgeDashArray(type: string): string | null {
  if (type === BPMN.MessageFlow) return '8,6';
  if (type === BPMN.Association || isDataAssociationType(type)) return '2,5';
  return null;
}

export function isDefaultFlow(edge: SceneEdge): boolean {
  return edge.type === BPMN.SequenceFlow && prop(edge.source?.businessObject, 'default') === edge.businessObject;
}

export function markerIdFor(type: string): string {
  if (type === BPMN.MessageFlow) return 'sf-arrow-message';
  if (EDGE_TYPES.has(type) && type !== BPMN.SequenceFlow) return 'sf-arrow-open';
  return 'sf-arrow-sequence';
}

/** A plain association is arrowless unless directed; everything else points somewhere. */
export function markerEndFor(type: string, businessObject?: ModdleObject): string | null {
  if (type === BPMN.Association) {
    const dir = prop(businessObject, 'associationDirection');
    if (dir !== 'One' && dir !== 'Both') return null;
  }
  return `url(#${markerIdFor(type)})`;
}

export function markerStartFor(type: string, isDefault = false): string | null {
  if (type === BPMN.MessageFlow) return 'url(#sf-marker-message-start)';
  return isDefault ? 'url(#sf-marker-default)' : null;
}

export function ensureArrowMarkers(defs: SVGDefsElement): void {
  if (defs.querySelector('#sf-arrow-sequence')) return;
  defs.appendChild(makeArrow('sf-arrow-sequence', true));
  defs.appendChild(makeArrow('sf-arrow-message', false));
  defs.appendChild(makeArrow('sf-arrow-open', false));
  const slash = marker('sf-marker-default', 0, 5);
  append(slash, create('path', { d: 'M3,2 L7,8', fill: 'none', stroke: 'context-stroke', 'stroke-width': 1.5 }));
  defs.appendChild(slash);
  // BPMN's message flow starts with a hollow circle. Its paint is an attribute, like every other colour the
  // renderer draws: an exported SVG carries no stylesheet, and a CSS variable there would fill it black.
  const circle = marker('sf-marker-message-start', 1.5, 5);
  append(circle, create('circle', { cx: 5, cy: 5, r: 3, fill: INK.fill, stroke: 'context-stroke', 'stroke-width': 1 }));
  defs.appendChild(circle);
}

function marker(id: string, refX: number, refY: number): SVGMarkerElement {
  return create('marker', {
    id, markerWidth: 10, markerHeight: 10, refX, refY, orient: 'auto', markerUnits: 'userSpaceOnUse',
  }) as SVGMarkerElement;
}

function makeArrow(id: string, filled: boolean): SVGMarkerElement {
  const m = marker(id, 8, 5);
  append(m, create('path', {
    d: 'M1,1 L9,5 L1,9 Z', fill: filled ? 'context-stroke' : 'none', stroke: 'context-stroke', 'stroke-width': 1, 'stroke-linejoin': 'round',
  }));
  return m;
}

export interface PreviewStyle {
  dash?: string | null;
  markerEnd?: string | null;
  markerStart?: string | null;
}

/** A transient line for a gesture preview, or `undefined` when `points` is not a line. */
export function previewEdge(points: readonly Point[], cssClass: string, style: PreviewStyle = {}): SVGPathElement | undefined {
  if (points.length < 2) return undefined;
  return create('path', {
    class: `sf-preview-line ${cssClass}`,
    d: roundedPathData(points),
    'data-waypoints': points.map((p) => `${p.x},${p.y}`).join(' '),
    'stroke-dasharray': style.dash ?? null,
    'marker-end': style.markerEnd ?? null,
    'marker-start': style.markerStart ?? null,
  }) as SVGPathElement;
}
