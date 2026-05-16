type PopupPosition = {
  x: number;
  y: number;
  cursor: {
    x: number;
    y: number;
  };
};

export type PaletteActivateLassoCommand = {
  type: 'palette-activate-lasso';
  event: any;
};

export type PaletteOpenPopupCommand = {
  type: 'palette-open-popup';
  popupType: string;
  position: PopupPosition;
  title: string;
};

export function runPaletteActivateLasso(modeler: any, command: PaletteActivateLassoCommand): void {
  modeler.get('lassoTool').activateSelection(command.event);
}

export function runPaletteOpenPopup(modeler: any, command: PaletteOpenPopupCommand): void {
  const rootElement = modeler.get('canvas').getRootElement();
  modeler.get('popupMenu').open(rootElement, command.popupType, command.position, {
    title: command.title,
    width: 300,
    search: false,
  });
}
