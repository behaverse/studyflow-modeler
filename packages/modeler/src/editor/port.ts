/**
 * The editor the app holds: the canvas and its study, plus the app services around
 * them (the document model, simulation). Built by `editor/mount.ts`.
 */

import type { Canvas, Study } from '@canvas/index.ts';
import type { Metamodel } from '@core/model/metamodel';
import type { EventBus } from '@modeler/editor/bus';

export type { Canvas, EventBus };

/** What the study is read and spelled by. */
export interface EditorModel {
  /** The metamodel of the schemas enabled in Settings. */
  metamodel(): Metamodel;
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
  /**
   * Put the study `text` spells, a `.studyflow.yaml` or BPMN XML, in place of this one; the history starts over.
   * `onWarning` hears what reading it could not place.
   */
  open(text: string, onWarning?: (message: string) => void): Promise<void>;
  /** The document as a BPMN XML file holds it (the study's `toXml`). */
  saveXML(): Promise<{ xml: string }>;
  /** What the canvas shows, as a standalone SVG drawn afresh, without the editor's chrome. */
  toSvg(): string;
  /** The document, and every write on it: one command, one `edit`, one undo step. */
  study: Study;
  /** The view: its selection, scope and camera, by id. */
  canvas: Canvas;
  /** The app's bus: what the canvas and the study announce, forwarded, and the commands. */
  events: EventBus;
  model: EditorModel;
  simulation: EditorSimulation;
  destroy(): void;
}
