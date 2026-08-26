import { bpmnSelfAndAncestors, getCatalog } from '@core/notation';
import { PALETTE_BPMN_ICONS } from '@modeler/palette/groups';
import { buildBusinessObject } from '@modeler/shape/buildBusinessObject';
import { getEditorPort } from '@modeler/editor/registry';
import type { PortHandle } from '@modeler/editor/registry';

export type PaletteStartCreateTemplateCommand = {
  type: 'PaletteStartCreateTemplate';
  templateId: string;
  event: MouseEvent | any;
};

export function runPaletteStartCreateTemplate(modeler: PortHandle, command: PaletteStartCreateTemplateCommand): any {
  const editor = getEditorPort(modeler);
  const template = editor.templates.getAll().find((t: any) => t.id === command.templateId);
  if (!template) return undefined;

  const created = editor.templates.createElement(template);

  if (Array.isArray(created)) {
    editor.gestures.startCreate(command.event, created, { hints: { autoSelect: [created[0]] } });
  } else {
    editor.gestures.startCreate(command.event, created);
  }
  editor.gestures.primeHover?.(command.event);

  return created;
}


export type PaletteStartCreateCommand = {
  type: 'PaletteStartCreate';
  bpmnType: string;
  event: MouseEvent | any;
  attributes?: Record<string, unknown>;
  extensionType?: string;
};

export function runPaletteStartCreate(modeler: PortHandle, command: PaletteStartCreateCommand): any {
  const editor = getEditorPort(modeler);
  const bo = buildBusinessObject(editor.model, command.bpmnType, {
    attributes: command.attributes,
    extensionType: command.extensionType,
  });
  const shape = editor.gestures.createShape({
    type: command.bpmnType,
    businessObject: bo,
  });

  editor.gestures.startCreate(command.event, shape);
  editor.gestures.primeHover?.(command.event);

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

export function runPaletteActivateLasso(modeler: PortHandle, command: PaletteActivateLassoCommand): void {
  getEditorPort(modeler).gestures.startLasso(command.event);
}

export function runPaletteOpenPopup(modeler: PortHandle, command: PaletteOpenPopupCommand): void {
  getEditorPort(modeler).popup.open(command.popupType, command.position, {
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
  _modeler: PortHandle,
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
