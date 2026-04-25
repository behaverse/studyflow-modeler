import type { CommandContext } from '../types';

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
  context: CommandContext,
  command: PaletteActivateLassoCommand,
): void {
  if (!context.modeler) {
    throw new Error("Command 'palette-activate-lasso' requires a modeler instance.");
  }

  const lassoTool = context.modeler.get('lassoTool');
  lassoTool.activateSelection(command.event);
}

export function runPaletteOpenPopup(
  context: CommandContext,
  command: PaletteOpenPopupCommand,
): void {
  if (!context.modeler) {
    throw new Error("Command 'palette-open-popup' requires a modeler instance.");
  }

  const popupMenu = context.modeler.get('popupMenu');
  const canvas = context.modeler.get('canvas');
  const rootElement = canvas.getRootElement();

  popupMenu.open(rootElement, command.popupType, command.position, {
    title: command.title,
    width: 300,
    search: false,
  });
}
