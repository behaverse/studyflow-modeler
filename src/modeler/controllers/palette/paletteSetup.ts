import RemoveTemplatesFromPopup from '@/modeler/views/palette/RemoveTemplatesFromPopup';
import { bpmnSelfAndAncestors, getCatalog } from '@/core/catalog';
import { PALETTE_BPMN_ICONS } from '@/modeler/infra/constants';

/** Most-specific palette icon for a BPMN type, walking up its ancestors. */
function resolveFallbackIcon(bpmnType: string): string | undefined {
  for (const type of bpmnSelfAndAncestors(bpmnType)) {
    const icon = PALETTE_BPMN_ICONS[type];
    if (icon) return icon;
  }
  return undefined;
}

const filteredPopupMenus = new WeakSet<object>();

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
  /** True for schemas backing default elements; false for third-party extensions. */
  core: boolean;
  items: PaletteItem[];
  templates: PaletteTemplate[];
};

export type ResolvePaletteSchemasCommand = {
  type: 'resolve-palette-schemas';
};

/** Palette content is a straight projection of the compiled type catalog. */
export function runResolvePaletteSchemas(
  modeler: any,
  _command: ResolvePaletteSchemasCommand,
): PaletteSchema[] {
  const popupMenu = modeler.get('popupMenu');
  if (!filteredPopupMenus.has(popupMenu)) {
    new (RemoveTemplatesFromPopup as any)(popupMenu);
    filteredPopupMenus.add(popupMenu);
  }

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
        icon: typeof type.meta?.icon === 'string'
          ? type.meta.icon
          : resolveFallbackIcon(type.bpmnType!),
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
