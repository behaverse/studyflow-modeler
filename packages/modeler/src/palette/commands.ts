import { bpmnSelfAndAncestors, getCatalog } from '@core/notation';
import { PALETTE_BPMN_ICONS } from '@modeler/palette/groups';
import { newShape } from '@modeler/palette/newShape';
import { openPopupMenu, type PopupPosition } from '@modeler/editor/popupMenus';
import type { Editor } from '@modeler/editor/port';

export type PaletteStartCreateTemplateCommand = {
  type: 'PaletteStartCreateTemplate';
  templateId: string;
  event: MouseEvent | any;
};

/** Drag a template from the palette: it drops as its shape, its flow laid out inside. */
export function runPaletteStartCreateTemplate(modeler: Editor, command: PaletteStartCreateTemplateCommand): boolean {
  return modeler.canvas.startCreate(command.event, { template: command.templateId });
}


export type PaletteStartCreateCommand = {
  type: 'PaletteStartCreate';
  bpmnType: string;
  event: MouseEvent | any;
  attributes?: Record<string, unknown>;
  extensionType?: string;
};

export function runPaletteStartCreate(modeler: Editor, command: PaletteStartCreateCommand): boolean {
  return modeler.canvas.startCreate(command.event, newShape(command.bpmnType, command.extensionType, command.attributes));
}

export type PaletteOpenPopupCommand = {
  type: 'PaletteOpenPopup';
  popupType: string;
  position: PopupPosition;
  title: string;
};

export function runPaletteOpenPopup(_modeler: Editor, command: PaletteOpenPopupCommand): void {
  openPopupMenu(command.popupType, command.position, {
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
  required: boolean;
  items: PaletteItem[];
  templates: PaletteTemplate[];
};

export type ResolvePaletteSchemasCommand = {
  type: 'ResolvePaletteSchemas';
};

export function runResolvePaletteSchemas(
  _modeler: Editor,
  _command: ResolvePaletteSchemasCommand,
): PaletteSchema[] {
  return getCatalog().schemas.map((schema): PaletteSchema => ({
    prefix: schema.prefix,
    name: schema.name,
    icon: schema.icon,
    required: schema.required,
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
