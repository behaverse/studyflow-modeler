/**
 * `@behaverse/studyflow-canvas`: the editable SVG canvas the modeler runs on.
 * Deep imports (`@canvas/routing/crop.ts`) are fine; this barrel is the stable surface.
 */

export { Canvas, type CanvasOptions, type CanvasViewbox, type Rect, type Root } from './Canvas.ts';
export type {
  Bounds,
  ElementColors,
  ModdleObject,
  Point,
  RootElement,
  Scene,
  SceneEdge,
  SceneElement,
  SceneLabel,
  SceneNode,
} from './model/scene.ts';
export { isRootElement } from './model/scene.ts';
export { importDefinitions, type ImportOptions } from './model/import.ts';
export { writeDi } from './model/di.ts';
export { IdGenerator, idPrefixFor, needsId, prefixFor } from './model/ids.ts';
export { isExpandable, isCollapsed } from './model/tree.ts';
export { Mutator } from './model/mutator.ts';
export { defaultSizeFor, type ShapeDescriptor } from './interaction/create.ts';
export { Selection } from './interaction/selection.ts';
export { Rules } from './rules/rules.ts';
export { setDocument, ownerDocument, remove as svgRemove } from './render/svg.ts';
export { injectCanvasStyles, CANVAS_CSS, CANVAS_STYLE_ID, INK } from './view/theme.ts';
export type { IconDef, IconResolver } from './render/icons.ts';
export { EventBus } from '@core/events/bus.ts';
