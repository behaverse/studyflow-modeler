/**
 * `@behaverse/studyflow-canvas`: a `Study` is the document, with no DOM (its reads, its verbs and their tools, its undo
 * history and the news of each change, all by id); a `Canvas` is a view of one, and several may share it; `renderSvg`
 * draws one without a view. This file is the package's whole surface, types included: the modeler imports from here
 * only (eslint.config.mjs), and the canvas's own specs may reach in. `./element` is `<studyflow-canvas>`.
 */

export { Canvas, type CanvasEvents, type CanvasOptions, type CanvasViewbox } from './Canvas.ts';
export { Study, type ChangedIds, type OpenOptions, type StudyChange, type StudyResult, type Verdict } from './study/Study.ts';
export { renderSvg, type RenderSvgOptions } from './render/renderSvg.ts';
export type { ElementRecord } from './study/records.ts';
export type { AttributeRecord } from './study/attributes.ts';
export type { NewElement, NewShape } from './study/prototype.ts';
export type { StudyWriter } from './study/writer.ts';
export type { Catalog, CatalogTemplate, CatalogType } from './study/catalog.ts';
export type { StudyTool, ToolResult } from './study/tools.ts';
export type { ImportOptions } from './study/import.ts';
export type { Bounds, Font, FontPatch, Point, TextAlign } from './study/scene.ts';
export type { IconDef, IconResolver } from './render/icons.ts';
