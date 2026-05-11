export type PaletteStartCreateTemplateCommand = {
  type: 'palette-start-create-template';
  templateId: string;
  event: MouseEvent | any;
};

export function runPaletteStartCreateTemplate(
  modeler: any,
  command: PaletteStartCreateTemplateCommand,
): any {
  if (!modeler) {
    throw new Error("Command 'palette-start-create-template' requires a modeler instance.");
  }

  const elementTemplates = modeler.get('elementTemplates');
  const create = modeler.get('create');

  const template = elementTemplates.getAll().find((t: any) => t.id === command.templateId);
  if (!template) return undefined;

  const created = elementTemplates.createElement(template);

  if (Array.isArray(created)) {
    create.start(command.event, created, {
      hints: { autoSelect: [created[0]] },
    });
  } else {
    create.start(command.event, created);
  }

  const evt = command.event as MouseEvent | undefined;
  if (evt && typeof evt.clientX === 'number') {
    const dragging = modeler.get('dragging');
    const canvas = modeler.get('canvas');
    const elementRegistry = modeler.get('elementRegistry');
    const rootElement = canvas.getRootElement();
    const rootGfx = elementRegistry.getGraphics(rootElement);
    dragging.hover({ element: rootElement, gfx: rootGfx });
    dragging.move(evt);
  }

  return created;
}
