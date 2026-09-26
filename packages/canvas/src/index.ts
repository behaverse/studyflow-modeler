/**
 * `@behaverse/studyflow-canvas`: the editable SVG canvas the modeler runs on. This file is its whole
 * surface: the modeler imports from here only (eslint.config.mjs); the canvas's own specs may reach in.
 */

export { Canvas, type CanvasOptions } from './Canvas.ts';
export type { Bounds, ElementRef, Font, FontPatch, Point, SceneEdge, SceneElement, SceneLabel, SceneNode, TextAlign } from './study/scene.ts';
export { isRootElement } from './study/scene.ts';
export { IdGenerator, idPrefixFor, needsId, prefixFor } from './study/ids.ts';
export { attachEventDefinitions } from './study/moddle.ts';
export { CONTENT_PADDING, isCollapsed, isExpandable, isExpanded, isHidden } from './study/tree.ts';
export { defaultSizeFor, type ShapeDescriptor } from './study/prototype.ts';
export { Selection } from './interaction/selection.ts';
export { SVG_ICON_PATHS, type IconDef } from './render/icons.ts';
export { append as svgAppend, attr as svgAttr, create as svgCreate, remove as svgRemove, setDocument } from './render/svg.ts';
export { INK } from './view/theme.ts';
export { EventBus } from './bus.ts';
