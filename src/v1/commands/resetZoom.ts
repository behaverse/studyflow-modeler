import type { CommandContext } from './types';

export type ResetZoomCommand = {
  type: 'reset-zoom';
};

export function runResetZoom(context: CommandContext, _command: ResetZoomCommand): void {
  if (!context.modeler) {
    throw new Error("Command 'reset-zoom' requires a modeler instance.");
  }

  context.modeler.get('canvas').zoom('fit-viewport');
}
