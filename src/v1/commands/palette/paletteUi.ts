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

export function runPaletteActivateLasso(
  modeler: any,
  command: PaletteActivateLassoCommand,
): void {
  if (!modeler) {
    throw new Error("Command 'palette-activate-lasso' requires a modeler instance.");
  }

  const lassoTool = modeler.get('lassoTool');
  lassoTool.activateSelection(command.event);
}

export function runPaletteOpenPopup(
  modeler: any,
  command: PaletteOpenPopupCommand,
): void {
  if (!modeler) {
    throw new Error("Command 'palette-open-popup' requires a modeler instance.");
  }

  const popupMenu = modeler.get('popupMenu');
  const canvas = modeler.get('canvas');
  const rootElement = canvas.getRootElement();

  popupMenu.open(rootElement, command.popupType, command.position, {
    title: command.title,
    width: 300,
    search: false,
  });
}
