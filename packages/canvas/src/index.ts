/**
 * `@behaverse/studyflow-canvas`: the editable SVG canvas the modeler runs on. This file is its whole
 * surface: the modeler imports from here only (eslint.config.mjs); the canvas's own specs may reach in.
 */

export { Canvas, type CanvasOptions } from './Canvas.ts';
export type { Bounds, FontPatch, Point, SceneEdge, SceneElement, SceneLabel, SceneNode, TextAlign } from './model/scene.ts';
export { isRootElement } from './model/scene.ts';
export { ensureChoreographyParticipants, mintParticipant } from './model/choreography.ts';
export { IdGenerator, idPrefixFor, needsId, prefixFor } from './model/ids.ts';
export { attachEventDefinitions, eventDefinitionTypeOf } from './model/moddle.ts';
export { CONTENT_PADDING, isCollapsed, isExpandable, isExpanded, isHidden } from './model/tree.ts';
export { defaultSizeFor, type ShapeDescriptor } from './interaction/create.ts';
export { Selection } from './interaction/selection.ts';
export { choreographyBandHeight } from './render/shapes.ts';
export { SVG_ICON_PATHS, type IconDef } from './render/icons.ts';
export { append as svgAppend, attr as svgAttr, create as svgCreate, remove as svgRemove, setDocument } from './render/svg.ts';
export { INK } from './view/theme.ts';
export { EventBus } from './bus.ts';
