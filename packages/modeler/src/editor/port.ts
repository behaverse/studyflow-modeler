/**
 * The editor the app holds: the canvas and its study, plus the app services around
 * them (the document model, templates, simulation). Built by `editor/mount.ts`.
 */

import type { Canvas, EventBus, Selection, ShapeDescriptor } from '@canvas/index.ts';
import { toBusinessObject } from '@core/element';
import type { Template } from '@core/notation';

export type { Canvas, EventBus, Selection };

/** A diagram element as app chrome reads it (a scene element or the root). */
export type EditorElement = any;

/** A moddle object (business object, DI, or extension element). */
export type ModelElement = any;

export type Moddle = import('bpmn-moddle').BpmnModdle;

/** Schema-aware document model access (bpmn-moddle). */
export interface EditorModel {
  moddle(): Moddle;
  /** The schema packages the moddle was built from, untouched: a converted document is built with the same ones. */
  packages(): Record<string, any>;
  create(type: string, properties?: Record<string, unknown>): ModelElement;
  /** An id-assigning business object. */
  createBusinessObject(type: string, properties?: Record<string, unknown>): ModelElement;
  ids: {
    nextPrefixed(prefix: string, element?: ModelElement): string;
    assigned(id: string): unknown;
  };
}

export interface EditorTemplates {
  getAll(): Template[];
  /** The shape a palette drag drops; a flow the template holds is laid out inside it once it lands. */
  createElement(template: Template): ShapeDescriptor;
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
  canvas: Canvas;
  /** The canvas's own selection and bus. */
  selection: Selection;
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
