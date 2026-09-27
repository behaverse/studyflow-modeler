/**
 * `@behaverse/studyflow-canvas`: the editable SVG canvas the modeler runs on. This file is its whole
 * surface: the modeler imports from here only (eslint.config.mjs); the canvas's own specs may reach in.
 */

export { Canvas, type CanvasEvents, type CanvasOptions } from './Canvas.ts';
export { Study, type ChangedIds, type OpenOptions, type StudyChange, type StudyResult, type Verdict } from './study/Study.ts';
export type { ElementRecord } from './study/records.ts';
export type { Catalog, CatalogTemplate, CatalogType } from './study/catalog.ts';
export type { StudyTool, ToolResult } from './study/tools.ts';
export type { StudyWriter } from './study/writer.ts';
export { renderSvg, type RenderSvgOptions } from './render/renderSvg.ts';
export type { ImportOptions } from './study/import.ts';
export type { Bounds, ElementRef, Font, FontPatch, Point, SceneEdge, SceneElement, SceneLabel, SceneNode, TextAlign } from './study/scene.ts';
export { isRootElement } from './study/scene.ts';
export { CONTENT_PADDING, isCollapsed, isExpandable, isExpanded, isHidden } from './study/tree.ts';
export type { NewElement, NewShape } from './study/prototype.ts';
export { Selection } from './interaction/selection.ts';
export { SVG_ICON_PATHS, type IconDef } from './render/icons.ts';
export { append as svgAppend, attr as svgAttr, create as svgCreate, remove as svgRemove } from './render/svg.ts';
export { INK } from './view/theme.ts';
