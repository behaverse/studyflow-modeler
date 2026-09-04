/**
 * Draws the scene: one `<g>` per node, edge and label in the elements layer, in
 * z-rank order. Icons come from the host's resolver.
 */

import { BPMN } from '@core/constants.ts';
import { getAttribute, getRawAttribute, isDataOperationActivity, StudyflowElement } from '@core/element/index.ts';
import { toLocalName } from '@core/naming.ts';
import { getCatalog } from '@core/notation/index.ts';

import { readChoreographyBands } from '@canvas/model/choreography.ts';
import { normalizeColor } from '@canvas/model/color.ts';
import { nameOf, prop } from '@canvas/model/moddle.ts';
import type { ModdleObject, Point, Scene, SceneEdge, SceneElement, SceneLabel, SceneNode } from '@canvas/model/scene.ts';
import { isCollapsed, isHidden, zRankOf } from '@canvas/model/tree.ts';
import { drawIcon, drawIconText, drawSvgPaths, SVG_ICON_PATHS, type IconResolver } from '@canvas/render/icons.ts';
import {
  drawBandText,
  drawInternalLabel,
  drawLabel,
  FONT,
  LABEL_CLASS,
  LABEL_FONT,
  LINE_HEIGHT,
  wrap,
} from '@canvas/render/labels.ts';
import {
  bandPath,
  categoryOf,
  choreographyBandHeight,
  CORNER_RADIUS,
  drawDataObject,
  drawDataStore,
  drawDiamond,
  drawEvent,
  drawGroup,
  drawParticipant,
  drawTask,
  drawTextAnnotation,
  PARTICIPANT_BAND,
  STROKE_WIDTH,
  type EventKind,
  type ShapeStyle,
} from '@canvas/render/shapes.ts';
import { append, create, group, remove } from '@canvas/render/svg.ts';
import { isDataStore } from '@canvas/rules/rules.ts';
import { INK } from '@canvas/view/theme.ts';

const THICK_ACTIVITY = new Set<string>([BPMN.CallActivity, 'bpmn:Transaction']);
const EDGE_TYPES = new Set<string>([
  BPMN.SequenceFlow, BPMN.MessageFlow, BPMN.Association, 'bpmn:DataInputAssociation', 'bpmn:DataOutputAssociation',
]);

const TYPE_ICON = { x: 10, y: 8, size: 18 };
const MARKER_SIZE = 16;
const OVERLAY_ICON_SIZE = 14;
const EVENT_ICON_SIZE = 18;
const ANNOTATION_PADDING = 7;

/** A behaverse task's scene abbreviation (`NB`, `SART`), drawn over its icon. */
function behaverseScene(bo: ModdleObject | undefined): string | undefined {
  if (getAttribute(bo, 'instrument') !== 'behaverse') return undefined;
  const element = StudyflowElement.fromBusinessObject(bo);
  if (getRawAttribute(element.extension ?? bo, 'icon')) return undefined;
  const scene = getAttribute(bo, 'behaverseScene');
  if (typeof scene !== 'string' || !scene) return undefined;
  const glyph = scene.toUpperCase();
  return glyph === 'UNDEFINED' ? undefined : glyph;
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
        this.drawEventIcons(g, node, kind === 'end' ? style.fill : style.stroke);
        break;
      }
      case 'task': {
        drawTask(g, node.width, node.height, style, THICK_ACTIVITY.has(node.type));
        const scene = behaverseScene(node.businessObject);
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
      case 'choreography':
        this.drawChoreography(g, node, style, name);
        this.drawOverlayIcons(g, node, iconColor);
        break;
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
      case 'participant':
        drawParticipant(g, node.width, node.height, style);
        this.drawParticipantLabel(g, node, name, INK.text);
        break;
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
      d: roundedPathData(edge.waypoints),
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

  private drawEventIcons(g: SVGGElement, node: SceneNode, color: string): void {
    const resolver = this.iconResolver;
    if (!resolver) return;
    const bo = node.businessObject;
    const x = (node.width - EVENT_ICON_SIZE) / 2;
    const y = (node.height - EVENT_ICON_SIZE) / 2;
    const defs = prop(bo, 'eventDefinitions');
    const def = Array.isArray(defs) ? (defs[0] as ModdleObject | undefined) : undefined;
    const defKey = def ? toLocalName(def.$type) : undefined;
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
    if (centreTaken) this.drawOverlayIcons(g, node, color, -2);
    else {
      for (const key of overlayIconsOf(bo)) {
        if (resolver(key)) drawIcon(g, key, x, y, EVENT_ICON_SIZE, color, resolver);
      }
    }
  }

  /** Schema-attribute badges in the top-right corner, stacking leftward. */
  private drawOverlayIcons(g: SVGGElement, node: SceneNode, color: string, inset = 6): void {
    const resolver = this.iconResolver;
    if (!resolver) return;
    let x = node.width - OVERLAY_ICON_SIZE - inset;
    for (const key of overlayIconsOf(node.businessObject)) {
      if (!resolver(key)) continue;
      drawIcon(g, key, x, inset, OVERLAY_ICON_SIZE, color, resolver);
      x -= OVERLAY_ICON_SIZE + 2;
    }
  }

  private drawDataIcons(g: SVGGElement, node: SceneNode, color: string): void {
    const resolver = this.iconResolver;
    if (!resolver) return;
    if (isDataStore(node.type)) {
      const key = formatIconOf(node.businessObject);
      if (key) {
        const def = SVG_ICON_PATHS[key];
        if (def) drawSvgPaths(g, def, 4, node.height - 22, node.width - 8, 14, color, key);
        else drawIcon(g, key, (node.width - 18) / 2, node.height - 22, 18, color, resolver);
        return;
      }
    }
    const key = toLocalName(node.type);
    if (!key || !resolver(key, node.businessObject)) return;
    const size = 18;
    drawIcon(g, key, (node.width - size) / 2, (node.height - size) / 2, size, color, resolver, node.businessObject);
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

  /** Bottom-centre activity markers, in BPMN's order. */
  private drawMarkers(g: SVGGElement, node: SceneNode, color: string): void {
    const bo = node.businessObject;
    const markers: string[] = [];
    const checklist = getAttribute(bo, 'checklist');
    if (Array.isArray(checklist) && checklist.length > 0) markers.push('checklist');
    if (isDataOperationActivity(bo)) markers.push('function');
    if (isCollapsed(node)) markers.push('subprocess');
    if (node.type === 'bpmn:AdHocSubProcess') markers.push('adhoc');
    if (prop(bo, 'isForCompensation') === true) markers.push('compensation');
    const loop = prop(bo, 'loopCharacteristics') as ModdleObject | undefined;
    if (loop) {
      const sequential = prop(loop, 'isSequential');
      markers.push(sequential === true ? 'sequential' : sequential === false ? 'parallel' : 'loop');
    }
    if (markers.length === 0) return;
    const gap = 4;
    const y = node.height - MARKER_SIZE - 6;
    const startX = (node.width - markers.length * MARKER_SIZE - (markers.length - 1) * gap) / 2;
    markers.forEach((marker, i) => {
      drawIcon(g, marker, startX + i * (MARKER_SIZE + gap), y, MARKER_SIZE, color, this.iconResolver, bo);
    });
  }

  /** A group's caption lives on its `bpmn:CategoryValue`, centred on the top edge. */
  private drawGroupLabel(g: SVGGElement, node: SceneNode, color: string): void {
    const categoryValue = prop(node.businessObject, 'categoryValueRef');
    const value = categoryValue && typeof categoryValue === 'object' ? prop(categoryValue as ModdleObject, 'value') : undefined;
    if (typeof value !== 'string' || !value) return;
    drawBandText(g, value, node.width / 2, 10, node.width, color, FONT.external);
  }

  private drawAnnotationText(g: SVGGElement, node: SceneNode, content: string, color: string): void {
    if (!content) return;
    const lines = wrap(content, Math.max(1, node.width - 2 * ANNOTATION_PADDING) + 8, FONT.annotation, 20);
    lines.forEach((line, i) => {
      const text = create('text', {
        class: LABEL_CLASS,
        x: ANNOTATION_PADDING,
        y: ANNOTATION_PADDING + (i + 0.5) * LINE_HEIGHT,
        'font-size': FONT.annotation,
        'font-family': LABEL_FONT,
        'dominant-baseline': 'middle',
        fill: color,
        'stroke-width': 0,
      });
      text.textContent = line;
      append(g, text);
    });
  }

  private drawParticipantLabel(g: SVGGElement, node: SceneNode, name: string, color: string): void {
    if (!name) return;
    const x = PARTICIPANT_BAND / 2;
    const text = create('text', {
      class: LABEL_CLASS,
      x,
      y: node.height / 2,
      transform: `rotate(-90, ${x}, ${node.height / 2})`,
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
      'font-size': FONT.internal,
      'font-weight': '500',
      'font-family': LABEL_FONT,
      fill: color,
      'stroke-width': 0,
    });
    text.textContent = name;
    append(g, text);
  }

  /** Two participant bands around the task's own name band. */
  private drawChoreography(g: SVGGElement, node: SceneNode, style: ShapeStyle, name: string): void {
    const { width, height } = node;
    const bandHeight = choreographyBandHeight(height);
    const { stroke, fill } = style;
    const bands = readChoreographyBands(node.businessObject);
    const receivingFill = node.fill ? darken(node.fill) : '#f5f5f4';
    const topFill = bands.initiator === 'top' ? '#ffffff' : receivingFill;
    const bottomFill = bands.initiator === 'bottom' ? '#ffffff' : receivingFill;

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

export const EDGE_CORNER_RADIUS = 6;

/** Straight runs joined by quarter-arc corners; the waypoints stay the geometry. */
export function roundedPathData(waypoints: readonly Point[], radius = EDGE_CORNER_RADIUS): string {
  if (waypoints.length === 0) return '';
  const first = waypoints[0];
  if (waypoints.length === 1) return `M ${round(first.x)} ${round(first.y)}`;
  let d = `M ${round(first.x)} ${round(first.y)}`;
  for (let i = 1; i < waypoints.length - 1; i += 1) {
    const prev = waypoints[i - 1];
    const corner = waypoints[i];
    const next = waypoints[i + 1];
    const r = Math.min(radius, Math.hypot(corner.x - prev.x, corner.y - prev.y) / 2, Math.hypot(next.x - corner.x, next.y - corner.y) / 2);
    const inDir = direction(prev, corner);
    const outDir = direction(corner, next);
    const cross = inDir.x * outDir.y - inDir.y * outDir.x;
    if (r <= 0 || Math.abs(cross) < 1e-6) {
      d += ` L ${round(corner.x)} ${round(corner.y)}`;
      continue;
    }
    const from = { x: corner.x - inDir.x * r, y: corner.y - inDir.y * r };
    const to = { x: corner.x + outDir.x * r, y: corner.y + outDir.y * r };
    d += ` L ${round(from.x)} ${round(from.y)} A ${round(r)} ${round(r)} 0 0 ${cross > 0 ? 1 : 0} ${round(to.x)} ${round(to.y)}`;
  }
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
  if (type === BPMN.Association || type === 'bpmn:DataInputAssociation' || type === 'bpmn:DataOutputAssociation') return '2,5';
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
  const circle = marker('sf-marker-message-start', 1.5, 5);
  append(circle, create('circle', { cx: 5, cy: 5, r: 3, fill: 'var(--sf-canvas-fill-color)', stroke: 'context-stroke', 'stroke-width': 1 }));
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
