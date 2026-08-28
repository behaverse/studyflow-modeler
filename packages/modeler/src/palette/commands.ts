import { isExpandable } from '@canvas/index.ts';
import { bpmnSelfAndAncestors, getCatalog } from '@core/notation';
import { PALETTE_BPMN_ICONS } from '@modeler/palette/groups';
import { buildBusinessObject } from '@canvas/model/build.ts';
import { openPopupMenu } from '@modeler/editor/popupMenus';
import type { Editor } from '@modeler/editor/port';

export type PaletteStartCreateTemplateCommand = {
  type: 'PaletteStartCreateTemplate';
  templateId: string;
  event: MouseEvent | any;
};

export function runPaletteStartCreateTemplate(modeler: Editor, command: PaletteStartCreateTemplateCommand): any {
  const template = modeler.templates.getAll().find((t: any) => t.id === command.templateId);
  if (!template) return undefined;

  const created = modeler.templates.createElement(template);

  // A template may describe several shapes; the create gesture drags the ROOT one
  // and the rest are materialized once it lands (`editor/mount.ts`).
  const root = Array.isArray(created) ? created[0] : created;
  if (root) modeler.canvas.startCreate(command.event, root);

  return created;
}


export type PaletteStartCreateCommand = {
  type: 'PaletteStartCreate';
  bpmnType: string;
  event: MouseEvent | any;
  attributes?: Record<string, unknown>;
  extensionType?: string;
};

export function runPaletteStartCreate(modeler: Editor, command: PaletteStartCreateCommand): any {
  const bo = buildBusinessObject(modeler.model, command.bpmnType, {
    attributes: command.attributes,
    extensionType: command.extensionType,
  });
  const shape = modeler.canvas.createShape({
    type: command.bpmnType,
    businessObject: bo,
    // A container dropped from the palette is born COLLAPSED — a 100×80 activity box
    // wearing the ⊞ marker and a drill-down badge, whose contents live in a nested
    // plane the create path mints alongside it (`Writeback.addNestedPlane`).
    // Without the explicit flag a `BPMNShape` that omits `isExpanded` reads as
    // expanded, and the drop produced a bare rectangle with no marker, no badge and
    // no way to author anything inside it.
    ...(isExpandable(command.bpmnType) ? { isExpanded: false } : {}),
  });

  modeler.canvas.startCreate(command.event, shape);

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

export function runPaletteActivateLasso(modeler: Editor, _command: PaletteActivateLassoCommand): void {
  // ARMS the tool; the NEXT drag draws the marquee. The button's own event is
  // deliberately not passed on — dragging empty canvas pans (parity spec §10), so
  // there is no gesture to continue from here, only a mode to enter.
  modeler.canvas.activateLasso();
}

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
  core: boolean;
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
