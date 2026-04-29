export type ResetZoomCommand = {
  type: 'reset-zoom';
};

export function runResetZoom(modeler: any, _command: ResetZoomCommand): void {
  if (!modeler) {
    throw new Error("Command 'reset-zoom' requires a modeler instance.");
  }

  modeler.get('canvas').zoom('fit-viewport');
}
