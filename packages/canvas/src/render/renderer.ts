/**
 * Per-type renderer dispatch (design §3 `render/renderer.ts`, mirrors the modeler's
 * `draw/Renderer.drawShape`). Given a {@link Scene}, draws every node and every edge
 * into the single `elements` layer, each as one `<g>` placed at its DI bounds, in the
 * composite z-order of `model/tree.ts zRankOf`. Read-only for P1: no interaction, no
 * writeback.
 *
 * Node types are categorized from the business-object `$type` local name (no
 * bpmn-js `ModelUtil.is`); the drawer set is the finite studyflow vocabulary
 * (design §2). Icons are placeholders unless an {@link IconResolver} is injected.
 */

import { BPMN } from '@core/constants.ts';
import {
  getAttribute,
  getRawAttribute,
  isDataOperationActivity,
  StudyflowElement,
} from '@core/element/index.ts';
import { toLocalName } from '@core/naming.ts';
import { getCatalog } from '@core/notation/index.ts';

import { readChoreographyBands } from '@canvas/model/choreography.ts';
import { normalizeColor } from '@canvas/model/color.ts';
import { isCollapsed, isHiddenByCollapse } from '@canvas/model/expand.ts';
import { prop } from '@canvas/model/moddle.ts';
import { zRankOf } from '@canvas/model/tree.ts';
import { DATA_TYPES, isDataStore } from '@canvas/rules/rules.ts';
import type {
  ModdleObject,
  Point,
  Scene,
  SceneEdge,
  SceneElement,
  SceneNode,
} from '@canvas/model/scene.ts';
import { append, create, group, remove } from '@canvas/render/svg.ts';
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
  labelIdOf,
  wrap,
  EXTERNAL_LABEL_FONT_SIZE,
  LABEL_CLASS,
  LABEL_FONT,
  LABEL_LINE_HEIGHT,
} from '@canvas/render/labels.ts';
import {
  drawIcon,
  drawIconText,
  drawSvgPaths,
  SVG_ICON_PATHS,
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

/**
 * The top-left type glyph's box, and the size it grows to when a scene abbreviation
 * too long for the plain box is drawn over it.
 *
 * The canvas draws the box at (5, 5) where `draw/Renderer` drew it at (4, 4), so the
 * sizes are 22/26 rather than its 24/28: both pairs put the box centre at 18 and both
 * grow by 4, which is what the fixed glyph placements in `render/icons.ts` are tuned
 * against. Moving either number without the other decentres every abbreviation.
 */
const TYPE_ICON_SIZE = 22;
const TYPE_ICON_SIZE_LARGE = 26;

/** Longest scene abbreviation the plain {@link TYPE_ICON_SIZE} box still fits. */
const LONG_SCENE_LENGTH = 2;

/**
 * The scene abbreviation a behaverse task draws over its hex icon (`'NB'`, `'SART'`),
 * or `undefined` for any other task.
 *
 * A hardcoded display convention of the behaverse instrument, not schema data —
 * ported from `draw/Renderer.drawActivity`. Two tasks draw nothing: one whose scene
 * is the literal `undefined` sentinel a task carries before an assessment is picked
 * (`runner/nodes/behaverse/parser.ts` reads it the same way), and one carrying its
 * OWN `icon` attribute, whose icon stays uncovered (the old `preservePrimaryIcon`).
 */
function behaverseScene(businessObject: ModdleObject | undefined): string | undefined {
  if (getAttribute(businessObject, 'instrument') !== 'behaverse') return undefined;
  const element = StudyflowElement.fromBusinessObject(businessObject);
  if (getRawAttribute(element.extension ?? businessObject, 'icon')) return undefined;
  const scene = getAttribute(businessObject, 'behaverseScene');
  if (typeof scene !== 'string' || !scene) return undefined;
  const glyph = scene.toUpperCase();
  return glyph === 'UNDEFINED' ? undefined : glyph;
}

/**
 * Icon keys of schema attributes declaring `meta.icon` that hold a value on `bo`
 * (studyflow's "overlay icon drawn on the event when this attribute is set").
 * A canvas running without loaded schemas has no catalog — then there are none.
 */
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

/**
 * The icon key of a data store's dataset format — the `DatasetFormatEnum` literal
 * matching its `format` attribute (`'bids'` → the BIDS logotype), or `undefined`
 * when no format is set, the literal declares no icon, or no schemas are loaded.
 */
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

/** Inset of a text annotation's note from its bracket (bpmn-js `TEXT_ANNOTATION_PADDING`). */
const ANNOTATION_PADDING = 7;

/** Hard ceiling on the lines of a text annotation, so a runaway string still ends. */
const ANNOTATION_MAX_LINES = 20;

/**
 * Where a group's caption sits, node-local: on the TOP edge of the frame, half a
 * default label height (`DEFAULT_LABEL_SIZE.height / 2` = 10) below it — bpmn-js's
 * `getExternalLabelMid` special-case for `bpmn:Group`.
 */
const GROUP_LABEL_MID_Y = 10;

/** The `text` of a business object (a `bpmn:TextAnnotation`'s note), or `''`. */
function textOf(businessObject: ModdleObject | undefined): string {
  const text = prop(businessObject, 'text');
  return typeof text === 'string' ? text : '';
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

/**
 * Choreography band shading (parity addendum "ChoreographyTask band coloring").
 *
 * A coloured choreography task paints its BODY with the chosen fill, keeps the
 * INITIATING participant's band near-white (the convention bpmn.io draws, so the
 * initiator reads as the light band whatever the task's colour), and shades the
 * NON-INITIATING band a step DARKER than the body. An uncoloured task keeps the
 * white/`#ededed` pair it has always drawn.
 */
const INITIATING_BAND_FILL = '#ffffff';
const RECEIVING_BAND_FILL = '#ededed';
const BAND_DARKEN = 0.12;

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

/** The fill the DI actually carries, or `undefined` for an uncoloured element. */
function fillAttrOf(node: SceneNode): string | undefined {
  return colorAttr(node.di, ['fill', 'background-color', 'bioc:fill', 'color:background-color']);
}

function fillOf(node: SceneNode): string {
  return fillAttrOf(node) ?? DEFAULT_FILL;
}

/**
 * `color` darkened by `amount` (0–1) in plain sRGB, keeping the `#rrggbb` form —
 * how a choreography's NON-INITIATING band is shaded against the task's own fill.
 *
 * A value this cannot parse (a CSS colour *name*, which needs a DOM to resolve) is
 * returned unchanged rather than thrown over: a band that fails to darken still
 * paints, and `normalizeColor` is the same parser the colour writeback uses.
 */
function darken(color: string, amount = BAND_DARKEN): string {
  let hex: string | undefined;
  try {
    hex = normalizeColor(color);
  } catch {
    return color;
  }
  if (!hex) return color;
  const value = Number.parseInt(hex.slice(1), 16);
  const channels = [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]
    .map((channel) => Math.max(0, Math.min(255, Math.round(channel * (1 - amount)))));
  return `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
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
 * Draws a {@link Scene} into the element layer. Holds a `graphicsById` map
 * (element id → its `<g>`) for later hit-testing / selection.
 */
export class Renderer {
  private readonly iconResolver?: IconResolver;
  readonly graphicsById = new Map<string, SVGGElement>();

  constructor(options: RendererOptions = {}) {
    this.iconResolver = options.iconResolver;
  }

  /**
   * Render every node and edge of `scene` into the ONE element layer, in the
   * composite order {@link zRankOf} defines: shallowest first, and within one depth
   * the edges before the nodes.
   *
   * Both halves of that key are load-bearing. Depth-first keeps containers behind
   * their contents, so an expanded sub-process's interior flows paint OVER its
   * opaque frame instead of under it (which is what a flat connections-below-shapes
   * stack got wrong). Edges-before-nodes *within* a depth keeps a root sequence
   * flow's arrowhead passing beneath the shape it points at, exactly as the split
   * stack drew it — a naive "edges last" would lift every arrowhead onto its target.
   *
   * EVERY plane is drawn, not just the visible one: which graphics a drill-down
   * shows is a view concern — `view/plane.ts` hides the off-plane `<g>`s with
   * `display: none` and `Canvas.setPlaneScope` gates hit-testing to match.
   */
  renderScene(scene: Scene, layer: SVGElement): void {
    this.graphicsById.clear();

    const drawable: SceneElement[] = [];
    for (const element of scene.elementsById.values()) {
      if (element.kind === 'node' || element.kind === 'edge') drawable.push(element);
    }
    // A STABLE sort, so elements that tie on the key keep document order.
    drawable.sort((a, b) => zRankOf(a) - zRankOf(b));

    for (const element of drawable) {
      const g = element.kind === 'node' ? this.drawShape(element) : this.drawEdge(element);
      append(layer, g);
      if (element.id) this.graphicsById.set(element.id, g);
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
    // The caption is drawn inside the element's own `<g>`, so it went with it; its
    // index entry has to go too or a stale label element stays addressable.
    this.graphicsById.delete(labelIdOf({ id }));
    return true;
  }

  /**
   * Index (or forget) the `<g>` an element's external label was drawn into, under
   * the label's own id — `model/externalLabel.ts` mints a scene element for that id,
   * and selection/outlining resolve its graphics through this very map.
   */
  private registerLabel(owner: SceneElement, gfx: SVGGElement | undefined): void {
    if (!owner.id) return;
    const id = labelIdOf(owner);
    if (gfx) this.graphicsById.set(id, gfx);
    else this.graphicsById.delete(id);
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
        this.drawEventIcons(g, node, style.stroke);
        this.registerLabel(node, drawExternalLabel(g, node, name, style.stroke, node.label));
        break;
      case 'task': {
        drawTask(g, node.width, node.height, style, THICK_ACTIVITY.has(node.type));
        // A behaverse task's scene abbreviation is drawn OVER its hex icon, and a
        // long one widens the hex to make room — so the glyph has to be derived
        // before the icon is sized.
        const scene = behaverseScene(node.businessObject);
        const iconSize = scene && scene.length > LONG_SCENE_LENGTH
          ? TYPE_ICON_SIZE_LARGE
          : TYPE_ICON_SIZE;
        this.drawTypeIcon(g, node, style.stroke, iconSize);
        drawIconText(g, scene, style.stroke);
        this.drawMarkers(g, node, style.stroke);
        this.drawOverlayIcons(g, node, style.stroke);
        drawInternalLabel(g, node, name, style.stroke);
        break;
      }
      case 'gateway':
        drawDiamond(g, node.width, node.height, style);
        this.drawGatewayGlyph(g, node, style.stroke);
        this.drawOverlayIcons(g, node, style.stroke);
        this.registerLabel(node, drawExternalLabel(g, node, name, style.stroke, node.label));
        break;
      case 'data':
        if (isDataStore(node.type)) drawDataStore(g, node.width, node.height, style);
        else drawDataObject(g, node.width, node.height, style);
        this.drawDataIcons(g, node, style.stroke);
        this.drawOverlayIcons(g, node, style.stroke);
        this.registerLabel(node, drawExternalLabel(g, node, name, style.stroke, node.label));
        break;
      case 'choreography':
        this.drawChoreography(g, node, style, name);
        this.drawOverlayIcons(g, node, style.stroke);
        break;
      case 'group':
        drawGroup(g, node.width, node.height, style);
        this.drawGroupLabel(g, node, style.stroke);
        break;
      case 'annotation':
        drawTextAnnotation(g, node.width, node.height, style);
        // A note's text lives in `text`, not `name` — see `drawAnnotationText`.
        this.drawAnnotationText(g, node, textOf(node.businessObject) || name, style.stroke);
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

  private drawTypeIcon(g: SVGGElement, node: SceneNode, color: string, size = TYPE_ICON_SIZE): void {
    // The top-left type glyph; a placeholder unless a resolver is injected.
    const key = toLocalName(node.type);
    if (!key) return;
    // A plain `bpmn:Task` has no BPMN type glyph of its own — the empty rounded box
    // IS the notation — so it never gets the placeholder. It DOES get a glyph when
    // the host names one, which is how a studyflow extension type's `iconClass`
    // reaches a task the document typed as a bare `bpmn:Task` (every cognitive /
    // agentic step in the shipped examples is one). Asking the resolver first is what
    // keeps the two apart: no resolver, or no answer, and nothing is drawn.
    if (key === 'Task' && !this.iconResolver?.(key, node.businessObject)) return;
    drawIcon(g, key, 5, 5, size, color, this.iconResolver, node.businessObject);
  }

  /**
   * Overlay glyphs on an event circle: the BPMN event-definition symbol (error,
   * timer, message…) first, then every schema attribute declaring `meta.icon`
   * that holds a value — the ported `draw/Renderer.drawEventWithIcon`. Gated on
   * the resolver ANSWERING, so a resolver-less canvas keeps the bare circle
   * instead of a placeholder box inside it.
   */
  private drawEventIcons(g: SVGGElement, node: SceneNode, color: string): void {
    const resolver = this.iconResolver;
    if (!resolver) return;
    const bo = node.businessObject;

    const defs = prop(bo, 'eventDefinitions');
    const def = Array.isArray(defs) ? (defs[0] as ModdleObject | undefined) : undefined;
    const defKey = def ? toLocalName(def.$type) : undefined;
    // The DEFINITION is the business object here: its own $type picks the glyph,
    // and the event's extension icon must not shadow it.
    if (defKey && resolver(defKey, def)) {
      drawIcon(g, defKey, 6, 6, 24, color, resolver, def);
    }

    for (const key of overlayIconsOf(bo)) {
      if (resolver(key)) drawIcon(g, key, 6, 6, 24, color, resolver);
    }
  }

  /**
   * Schema-attribute overlay glyphs (`meta.icon` declaring an icon, drawn when the
   * attribute holds a value) on a NON-event shape, as a badge row in the top-right
   * corner, stacking leftward. Events keep their own centred placement
   * ({@link drawEventIcons}); like there, a resolver that does not answer draws
   * nothing rather than a placeholder.
   */
  private drawOverlayIcons(g: SVGGElement, node: SceneNode, color: string): void {
    const resolver = this.iconResolver;
    if (!resolver) return;
    const size = 16;
    const gap = 2;
    let x = node.width - size - 4;
    for (const key of overlayIconsOf(node.businessObject)) {
      if (!resolver(key)) continue;
      drawIcon(g, key, x, 4, size, color, resolver);
      x -= size + gap;
    }
  }

  /**
   * Glyphs on a data object / data store — the ported `draw/Renderer.drawDataStore`
   * plus the type icon the old renderer never got around to:
   *
   * - A data store whose `format` attribute matches a `DatasetFormatEnum` literal
   *   declaring an `icon` draws that icon low in the cylinder (BIDS logo, BDM hex).
   * - Otherwise the extension type's / template's own glyph is drawn centred in the
   *   shape. A plain `bpmn:DataObjectReference`/`DataStoreReference` draws nothing —
   *   the folded document / cylinder IS the notation, and the resolver answers
   *   `null` for it (`editor/mount.ts resolveIcon`).
   */
  private drawDataIcons(g: SVGGElement, node: SceneNode, color: string): void {
    const resolver = this.iconResolver;
    if (!resolver) return;

    // Format icons are drawn dimmed, like the old renderer's stroke + `bb` alpha.
    let hex: string | undefined;
    try { hex = normalizeColor(color); } catch { /* named colour; fall back below */ }
    const dimmed = `${hex ?? '#000000'}bb`;

    if (isDataStore(node.type)) {
      const key = formatIconOf(node.businessObject);
      if (key) {
        const def = SVG_ICON_PATHS[key];
        // A wide logotype (BIDS) scales into a low band across the cylinder; a
        // square iconify glyph sits centred just above the bottom rim — the old
        // (4, 28, 42×14) / (15, 27, 20) placements, generalized to the node size.
        if (def) drawSvgPaths(g, def, 4, node.height - 22, node.width - 8, 14, dimmed, key);
        else drawIcon(g, key, (node.width - 20) / 2, node.height - 23, 20, dimmed, resolver);
        return;
      }
    }

    const key = toLocalName(node.type);
    if (!key || !resolver(key, node.businessObject)) return;
    const size = 20;
    drawIcon(g, key, (node.width - size) / 2, (node.height - size) / 2, size, color, resolver, node.businessObject);
  }

  private drawGatewayGlyph(g: SVGGElement, node: SceneNode, color: string): void {
    // The resolver knows richer glyphs than the unicode table below: the
    // extension type's `meta.icon` (a random gateway's dice) or the app's BPMN
    // overrides — the ported `draw/Renderer.drawGateway` placement (13, 13, 24).
    const key = toLocalName(node.type);
    if (key && this.iconResolver?.(key, node.businessObject)) {
      drawIcon(g, key, 13, 13, 24, color, this.iconResolver, node.businessObject);
      return;
    }
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
   * Bottom-centre activity markers (design §2) — the set and order BPMN prescribes,
   * kept from the ported `drawMarkers` so the shipped documents read unchanged. Each
   * marker is drawn by KEY; the injected resolver turns the key into a glyph.
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

  /**
   * A group's caption. BPMN keeps it on the referenced `bpmn:CategoryValue` rather
   * than on the group itself (bpmn-js `LabelUtil.getLabelAttr` answers
   * `categoryValueRef` for a `bpmn:Group`), which is why reading `name` drew nothing
   * at all, and it is centred on the frame's TOP edge — `getExternalLabelMid` puts a
   * group's label mid at `y + DEFAULT_LABEL_SIZE.height / 2`, i.e. 10 below the top,
   * instead of below the shape like every other caption.
   *
   * It is DRAWN here but is not (yet) an editable label ELEMENT: committing an edit
   * means minting the `bpmn:Category` / `bpmn:CategoryValue` pair the way bpmn-js's
   * `GroupBehavior` does, which is P6b.
   */
  private drawGroupLabel(g: SVGGElement, node: SceneNode, color: string): void {
    const categoryValue = prop(node.businessObject, 'categoryValueRef');
    const value = categoryValue && typeof categoryValue === 'object'
      ? prop(categoryValue as ModdleObject, 'value')
      : undefined;
    if (typeof value !== 'string' || !value) return;
    drawBandText(
      g,
      value,
      node.width / 2,
      GROUP_LABEL_MID_Y,
      node.width,
      color,
      EXTERNAL_LABEL_FONT_SIZE,
      '400',
    );
  }

  /**
   * A text annotation's note, top-left inside the bracket and wrapped to the shape —
   * bpmn-js reads `semantic.get('text')` and lays it out `left-top` with
   * `TEXT_ANNOTATION_PADDING`. The old single truncated line came from `name`, which
   * on a `bpmn:TextAnnotation` is a different (usually placeholder) string.
   */
  private drawAnnotationText(
    g: SVGGElement,
    node: SceneNode,
    content: string,
    color: string,
  ): void {
    if (!content) return;
    const fontSize = 12;
    const inner = Math.max(1, node.width - 2 * ANNOTATION_PADDING);
    // Deliberately NOT clamped to the box height: bpmn-js lays a note out to as many
    // lines as it takes and lets it overflow the bracket (the shape is resizable, and
    // silently ellipsizing a comment loses the only content the element has). The cap
    // is a guard against a pathological string, not a layout rule.
    const lines = wrap(content, inner + 8, fontSize, ANNOTATION_MAX_LINES);
    lines.forEach((line, i) => {
      const text = create('text', {
        class: LABEL_CLASS,
        x: ANNOTATION_PADDING,
        y: ANNOTATION_PADDING + (i + 0.5) * LABEL_LINE_HEIGHT,
        'font-size': fontSize,
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
    // Vertical label in the left title band.
    const text = create('text', {
      class: LABEL_CLASS,
      x: 15,
      y: node.height / 2,
      transform: `rotate(-90, 15, ${node.height / 2})`,
      'text-anchor': 'middle',
      'dominant-baseline': 'central',
      'font-size': 12,
      'font-family': LABEL_FONT,
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
    const bands = readChoreographyBands(node.businessObject);
    // The chosen colour, not the default: an uncoloured task shades its receiving
    // band with the flat gray, a coloured one with its own fill darkened.
    const chosen = fillAttrOf(node);
    const initiatingFill = INITIATING_BAND_FILL;
    const receivingFill = chosen ? darken(chosen) : RECEIVING_BAND_FILL;

    append(g, create('rect', {
      x: 0, y: 0, rx: CORNER_RADIUS, ry: CORNER_RADIUS, width, height,
      fill, stroke, 'stroke-width': 2,
      'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    }));

    const topFill = bands.initiator === 'top' ? initiatingFill : receivingFill;
    const bottomFill = bands.initiator === 'bottom' ? initiatingFill : receivingFill;
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
      // The task name belongs in the MIDDLE band. Every drawer works in the
      // element's local frame (the `<g>` already carries the translate), so the
      // downward shift has to be a nested group — writing `y: node.y + bandHeight`
      // on the node copy is inert, and the name would centre one band-height too
      // high, straight on top of the divider line and the top participant's name.
      const inner = append(g, group(0, bandHeight));
      drawInternalLabel(inner, { ...node, height: height - 2 * bandHeight } as SceneNode, name, stroke);
    }
  }

  /**
   * Draw one edge as a path through its waypoints — with ROUNDED corner bends —
   * carrying a flow-typed arrowhead.
   *
   * A `<path>` rather than a `<polyline>` because bpmn-js's bends are arcs, not
   * mitres (`edge-videos/edgemake/frame_02`, `dnd/frame_08`): diagram-js draws every
   * connection through `createLine(..., { cornerRadius: 5 })`. The waypoint geometry
   * is unchanged — the arcs are cut out of the corners, never added around them —
   * and the raw list is kept verbatim in `data-waypoints` so anything reading the
   * drawn path's points still can.
   */
  drawEdge(edge: SceneEdge): SVGGElement {
    const g = group(0, 0, {
      class: 'sf-connection',
      'data-element-id': edge.id,
      'data-element-type': edge.type,
      display: isHiddenByCollapse(edge) ? 'none' : null,
    });
    const points = edge.waypoints.map((p) => `${p.x},${p.y}`).join(' ');
    const stroke = colorAttr(edge.di, ['stroke', 'border-color', 'bioc:stroke', 'color:border-color']) ?? DEFAULT_STROKE;

    const line = create('path', {
      class: 'sf-connection-line',
      d: roundedPathData(edge.waypoints),
      'data-waypoints': points,
      fill: 'none',
      stroke,
      'stroke-width': 2,
      'stroke-linejoin': 'round',
      'stroke-linecap': 'round',
      'stroke-dasharray': edgeDashArray(edge.type),
      'marker-end': markerEndFor(edge.type, edge.businessObject),
      'marker-start': isDefaultFlow(edge) ? 'url(#sf-marker-default)' : null,
    });
    append(g, line);
    const name = prop(edge.businessObject, 'name');
    this.registerLabel(
      edge,
      typeof name === 'string' && name
        ? drawEdgeLabel(g, edge, name, stroke, edge.label)
        : undefined,
    );
    return g;
  }
}

/**
 * The `stroke-dasharray` a flow type is drawn with, or `null` for a solid line: a
 * message flow uses the long BPMN dash, an association (data associations included)
 * the short dot, everything else is solid.
 *
 * Exported because the context pad's hover ghost (`Canvas.previewAppend`) draws a
 * connection that does not exist yet, and it has to look like the one a click would
 * commit — same dash, same arrowhead ({@link markerIdFor}).
 */
/**
 * Radius of a connection's corner bend — diagram-js's `BpmnRenderer` passes
 * `cornerRadius: 5` to every `createLine`, and the reference frames show exactly
 * that soft a turn.
 */
export const EDGE_CORNER_RADIUS = 5;

/**
 * The `d` of a connection: straight runs joined by quarter-arc corners.
 *
 * Each corner is cut back by `min(radius, half of either adjacent run)`, so a short
 * jog rounds proportionally instead of overshooting into its neighbours, and a
 * corner that is not really a corner (three collinear points, or a degenerate
 * duplicate) falls back to a plain line — the geometry stays exactly the waypoint
 * list, which is what the DI holds and what every test measures.
 *
 * Exported because the live previews draw connections that do not exist yet
 * (`Canvas.previewAppend`, `interaction/connect.ts`) and have to look like the one a
 * drop would commit.
 */
export function roundedPathData(
  waypoints: readonly Point[],
  radius = EDGE_CORNER_RADIUS,
): string {
  if (waypoints.length === 0) return '';
  const first = waypoints[0];
  if (waypoints.length === 1) return `M ${round(first.x)} ${round(first.y)}`;

  let d = `M ${round(first.x)} ${round(first.y)}`;
  for (let i = 1; i < waypoints.length - 1; i += 1) {
    const prev = waypoints[i - 1];
    const corner = waypoints[i];
    const next = waypoints[i + 1];
    const inLength = Math.hypot(corner.x - prev.x, corner.y - prev.y);
    const outLength = Math.hypot(next.x - corner.x, next.y - corner.y);
    const r = Math.min(radius, inLength / 2, outLength / 2);
    const inDir = direction(prev, corner);
    const outDir = direction(corner, next);
    const cross = inDir.x * outDir.y - inDir.y * outDir.x;
    if (r <= 0 || Math.abs(cross) < 1e-6) {
      // Collinear (or degenerate): nothing to round.
      d += ` L ${round(corner.x)} ${round(corner.y)}`;
      continue;
    }
    const from = { x: corner.x - inDir.x * r, y: corner.y - inDir.y * r };
    const to = { x: corner.x + outDir.x * r, y: corner.y + outDir.y * r };
    d += ` L ${round(from.x)} ${round(from.y)}`;
    d += ` A ${round(r)} ${round(r)} 0 0 ${cross > 0 ? 1 : 0} ${round(to.x)} ${round(to.y)}`;
  }
  const last = waypoints[waypoints.length - 1];
  return `${d} L ${round(last.x)} ${round(last.y)}`;
}

/** Unit vector from `a` to `b` (the zero vector when they coincide). */
function direction(a: Point, b: Point): Point {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  return length < 1e-6 ? { x: 0, y: 0 } : { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
}

/** Path numbers are trimmed to 3 decimals: an arc endpoint is never a round number. */
function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function edgeDashArray(type: string): string | null {
  if (type === BPMN.MessageFlow) return '10,8';
  if (
    type === BPMN.Association
    || type === 'bpmn:DataInputAssociation'
    || type === 'bpmn:DataOutputAssociation'
  ) return '2,6';
  return null;
}

/**
 * Whether `edge` is its source's DEFAULT sequence flow — the one a gateway (or
 * activity) takes when no condition matches, which BPMN notates as a short slash
 * across the line just after it leaves the source.
 */
export function isDefaultFlow(edge: SceneEdge): boolean {
  return edge.type === BPMN.SequenceFlow
    && !!edge.businessObject
    && prop(edge.source?.businessObject, 'default') === edge.businessObject;
}

/** The arrowhead marker id for a flow type (defined once in the canvas `<defs>`). */
export function markerIdFor(type: string): string {
  if (type === BPMN.MessageFlow) return 'sf-arrow-message';
  if (EDGE_TYPES.has(type) && type !== BPMN.SequenceFlow) return 'sf-arrow-open';
  return 'sf-arrow-sequence';
}

/**
 * `marker-end` for a flow of `type`, or `null` for one drawn with no arrowhead.
 *
 * Only a plain `bpmn:Association` can be arrowless, and BPMN says which by its
 * `associationDirection`: `None` (the default, and what a text-annotation leader
 * gets) draws a bare dotted line — `edge-videos/preview/frame_08` — while `One` and
 * `Both` earn the open arrow. Everything else, data associations included, always
 * points somewhere.
 */
export function markerEndFor(type: string, businessObject?: ModdleObject): string | null {
  if (type === BPMN.Association) {
    const direction = prop(businessObject, 'associationDirection');
    if (direction !== 'One' && direction !== 'Both') return null;
  }
  return `url(#${markerIdFor(type)})`;
}


/** Install the arrowhead marker `<defs>` once into `defs`. */
export function ensureArrowMarkers(defs: SVGDefsElement): void {
  if (defs.querySelector('#sf-arrow-sequence')) return;
  defs.appendChild(makeMarker('sf-arrow-sequence', 'filled'));
  defs.appendChild(makeMarker('sf-arrow-message', 'open'));
  defs.appendChild(makeMarker('sf-arrow-open', 'open'));
  defs.appendChild(makeDefaultFlowMarker());
}

/** The default-flow slash ({@link isDefaultFlow}), oriented with the line's start. */
function makeDefaultFlowMarker(): SVGMarkerElement {
  const marker = create('marker', {
    id: 'sf-marker-default',
    markerWidth: 12,
    markerHeight: 12,
    refX: 0,
    refY: 6,
    orient: 'auto',
    markerUnits: 'userSpaceOnUse',
  }) as SVGMarkerElement;
  append(marker, create('path', {
    d: 'M4,2 L8,10',
    fill: 'none',
    stroke: 'context-stroke',
    'stroke-width': 1.5,
  }));
  return marker;
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
