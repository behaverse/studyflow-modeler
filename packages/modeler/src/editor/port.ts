/**
 * The editor the app holds: the canvas and its study, plus the app services around
 * them (the document model, templates, simulation). Built by `editor/mount.ts`.
 */

import type { Canvas, Study } from '@canvas/index.ts';
import { toBusinessObject } from '@core/element';
import type { Template } from '@core/notation';
import type { EventBus } from '@modeler/editor/bus';

export type { Canvas, EventBus };

/** A diagram element as app chrome reads it (a scene element or the root). */
export type EditorElement = any;

/** A moddle object (business object, DI, or extension element). */
export type ModelElement = any;

export type Moddle = import('bpmn-moddle').BpmnModdle;

/** Schema-aware document model access (bpmn-moddle): what reads and writes files; the study mints what it adds. */
export interface EditorModel {
  moddle(): Moddle;
  /** The schema packages the moddle was built from, untouched: a converted document is built with the same ones. */
  packages(): Record<string, any>;
}

export interface EditorTemplates {
  getAll(): Template[];
}

export interface EditorSimulation {
  toggle(): void;
  isActive(): boolean;
}

export interface Editor {
  /** The study's revision: up by one on every change, an edit, an undo, a redo or an import. */
  revision(): number;
  /** The study's undo history. */
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;
  importXML(xml: string): Promise<{ warnings: unknown[] }>;
  /** The document as a BPMN XML file holds it (the study's `toXml`). */
  saveXML(): Promise<{ xml: string }>;
  /** What the canvas shows, as a standalone SVG drawn afresh, without the editor's chrome. */
  toSvg(): string;
  getDefinitions(): ModelElement | undefined;
  /** The document, and every write on it: one command, one `edit`, one undo step. */
  study: Study;
  /** The view: its selection, scope and camera, by id. */
  canvas: Canvas;
  /** The app's bus: what the canvas and the study announce, forwarded, and the commands. */
  events: EventBus;
  model: EditorModel;
  templates: EditorTemplates;
  simulation: EditorSimulation;
  destroy(): void;
}

export function is(element: EditorElement | ModelElement, type: string): boolean {
  const bo: any = toBusinessObject(element);
  return !!bo && typeof bo.$instanceOf === 'function' && bo.$instanceOf(type);
}
