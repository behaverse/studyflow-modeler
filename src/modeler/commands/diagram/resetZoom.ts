export type ResetZoomCommand = {
  type: 'reset-zoom';
};

export function runResetZoom(modeler: any, _command: ResetZoomCommand): void {
  modeler.get('canvas').zoom('fit-viewport');
}
