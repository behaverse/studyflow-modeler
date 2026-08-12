import { bpmnSelfAndAncestors, getCatalog } from '@behaverse/studyflow-core/notation';
import { PALETTE_BPMN_ICONS } from '@/modeler/palette/groups';
import { buildBusinessObject } from '@/modeler/shape/buildBusinessObject';
import type { Modeler } from '@/modeler/bpmn/types';

/** Without a primed hover the dragger draws no CreatePreview until the next mouse move. */
function primeHoverFromEvent(modeler: Modeler, event: MouseEvent | any): void {
  if (!event || typeof event.clientX !== 'number') return;

  const dragging = modeler.get('dragging');
  const canvas = modeler.get('canvas');
  const elementRegistry = modeler.get('elementRegistry');
  const rootElement = canvas.getRootElement();
  const rootGfx = elementRegistry.getGraphics(rootElement);

  dragging.hover({ element: rootElement, gfx: rootGfx });
  dragging.move(event);
}


export type PaletteStartCreateTemplateCommand = {
  type: 'PaletteStartCreateTemplate';
  templateId: string;
  event: MouseEvent | any;
};

export function runPaletteStartCreateTemplate(modeler: Modeler, command: PaletteStartCreateTemplateCommand): any {
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


export type PaletteStartCreateCommand = {
  type: 'PaletteStartCreate';
  bpmnType: string;
  event: MouseEvent | any;
  attributes?: Record<string, unknown>;
  extensionType?: string;
};

export function runPaletteStartCreate(modeler: Modeler, command: PaletteStartCreateCommand): any {
  const bo = buildBusinessObject(modeler, command.bpmnType, {
    attributes: command.attributes,
    extensionType: command.extensionType,
  });
  const shape = modeler.get('elementFactory').createShape({
    type: command.bpmnType,
    businessObject: bo,
  });

  modeler.get('create').start(command.event, shape);
  primeHoverFromEvent(modeler, command.event);

  return shape;
}

type PopupPosition = {
  x: number;
  y: number;
  cursor: {
    x: number;
    y: number;
  };
};

export type PaletteActivateLassoCommand = {
  type: 'PaletteActivateLasso';
  event: any;
};

export type PaletteOpenPopupCommand = {
  type: 'PaletteOpenPopup';
  popupType: string;
  position: PopupPosition;
  title: string;
};

export function runPaletteActivateLasso(modeler: Modeler, command: PaletteActivateLassoCommand): void {
  modeler.get('lassoTool').activateSelection(command.event);
}

export function runPaletteOpenPopup(modeler: Modeler, command: PaletteOpenPopupCommand): void {
  // `popupMenu.open` types its target more narrowly than the `RootLike` it accepts.
  const rootElement = modeler.get('canvas').getRootElement() as any;
  modeler.get('popupMenu').open(rootElement, command.popupType, command.position, {
    title: command.title,
    width: 300,
    search: false,
  });
}

function resolveFallbackIcon(bpmnType: string): string | undefined {
  for (const type of bpmnSelfAndAncestors(bpmnType)) {
    const icon = PALETTE_BPMN_ICONS[type];
    if (icon) return icon;
  }
  return undefined;
}

export type PaletteItem = {
  label: string;
  bpmnType: string;
  extensionType: string;
  icon?: string;
  categories: string[];
};

export type PaletteTemplate = {
  id: string;
  label: string;
  description?: string;
  icon?: string;
  bpmnType: string;
  extensionType?: string;
};

export type PaletteSchema = {
  prefix: string;
  name: string;
  icon?: string;
  core: boolean;
  items: PaletteItem[];
  templates: PaletteTemplate[];
};

export type ResolvePaletteSchemasCommand = {
  type: 'ResolvePaletteSchemas';
};

export function runResolvePaletteSchemas(
  _modeler: Modeler,
  _command: ResolvePaletteSchemasCommand,
): PaletteSchema[] {
  return getCatalog().schemas.map((schema): PaletteSchema => ({
    prefix: schema.prefix,
    name: schema.name,
    icon: schema.icon,
    core: schema.core,
    items: schema.types
      .filter((type) => !type.hiddenFromPalette && type.bpmnType)
      .map((type): PaletteItem => ({
        label: type.paletteLabel,
        bpmnType: type.bpmnType!,
        extensionType: type.name,
        icon: type.iconClass ?? resolveFallbackIcon(type.bpmnType!),
        categories: type.paletteCategories,
      })),
    templates: schema.templates.map((template): PaletteTemplate => ({
      id: template.id,
      label: template.name,
      description: template.description,
      icon: template.iconClass,
      bpmnType: template.bpmnType,
      extensionType: template.extensionType,
    })),
  }));
}
