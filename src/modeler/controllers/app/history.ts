/**
 * Undo/redo over the modeler's command stack, as bus commands — so views
 * other than the canvas (the Provenance dialog, say) can step history
 * without relying on keyboard focus reaching bpmn-js.
 */

export type UndoCommand = { type: 'undo' };
export type RedoCommand = { type: 'redo' };

export function runUndo(modeler: any, _command: UndoCommand): void {
  modeler.get('commandStack').undo();
}

export function runRedo(modeler: any, _command: RedoCommand): void {
  modeler.get('commandStack').redo();
}
