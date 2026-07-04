import { primeHoverFromEvent } from '@/modeler/controllers/commands/palette/primeHover';

export type PaletteStartCreateTemplateCommand = {
  type: 'palette-start-create-template';
  templateId: string;
  event: MouseEvent | any;
};

export function runPaletteStartCreateTemplate(modeler: any, command: PaletteStartCreateTemplateCommand): any {
  const elementTemplates = modeler.get('elementTemplates');
  const template = elementTemplates.getAll().find((t: any) => t.id === command.templateId);
  if (!template) return undefined;

  const created = elementTemplates.createElement(template);
  const create = modeler.get('create');

  if (Array.isArray(created)) {
    create.start(command.event, created, { hints: { autoSelect: [created[0]] } });
  } else {
    create.start(command.event, created);
  }
  primeHoverFromEvent(modeler, command.event);

  return created;
}
