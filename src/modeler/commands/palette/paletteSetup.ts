import RemoveTemplatesFromPopup from '../../palette/RemoveTemplatesFromPopup';
import { resolveBpmnCreateType } from '../../moddle/resolveBpmnType';
import { toLocalName } from '@/lib/core/utils/naming';
import { HIDDEN_SCHEMA_TYPES, PALETTE_BPMN_ICONS, PRIMITIVE_MODDLE_TYPES, SCHEMA_NAMES, SCHEMAS } from '../../constants';
import type { Template as ElementTemplate } from '../../moddle/templates/types';

function getBpmnTypeDefinition(moddle: any, bpmnType: string): any | null {
  try { return moddle.getType(bpmnType)?.$descriptor ?? null; }
  catch { return null; }
}

function resolveFallbackIcon(moddle: any, bpmnType: string): string | undefined {
  if (PALETTE_BPMN_ICONS[bpmnType]) return PALETTE_BPMN_ICONS[bpmnType];

  const ancestors: any[] = getBpmnTypeDefinition(moddle, bpmnType)?.allTypes ?? [];
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const icon = PALETTE_BPMN_ICONS[ancestors[i]?.name];
    if (icon) return icon;
  }
  return undefined;
}

const filteredPopupMenus = new WeakSet<object>();
const schemaOrder = new Map(SCHEMA_NAMES.map((schemaName, index) => [schemaName, index]));

/** Prefixes never shown in user-facing palette flyouts. */
const NON_USER_PREFIXES = new Set(['bpmn', 'bpmndi', 'di', 'dc', 'bioc', 'color']);

/** Skip abstract types, primitives, `extends:`-only types, and template-only types. */
function isHiddenFromPalette(type: any): boolean {
  if (type.isAbstract || HIDDEN_SCHEMA_TYPES.has(type.name)) return true;
  if (type.superClass?.some((sc: string) => PRIMITIVE_MODDLE_TYPES.includes(sc))) return true;
  if (Array.isArray(type.meta?.flowElements) && type.meta.flowElements.length > 0) return true;
  if (Array.isArray(type.extends) && type.extends.length > 0
      && (!Array.isArray(type.superClass) || type.superClass.length === 0)) return true;
  if (type.meta?.templateScopedType) return true;
  return false;
}

// Order matters: SubProcess/Participant/Group come before Activity so they land in "Containers".
const CATEGORY_RULES: Array<{ ancestor: string; category: string }> = [
  { ancestor: 'bpmn:Event', category: 'Events' },
  { ancestor: 'bpmn:Gateway', category: 'Gateways' },
  { ancestor: 'bpmn:SubProcess', category: 'Containers' },
  { ancestor: 'bpmn:Participant', category: 'Containers' },
  { ancestor: 'bpmn:Group', category: 'Containers' },
  { ancestor: 'bpmn:Activity', category: 'Activities' },
  { ancestor: 'bpmn:DataObjectReference', category: 'Data' },
  { ancestor: 'bpmn:DataStoreReference', category: 'Data' },
  { ancestor: 'bpmn:ItemAwareElement', category: 'Data' },
];

const STRIPPABLE_SUFFIXES = ['Gateway', 'Event'];

/** Drop the BPMN base-type suffix (e.g. "ExclusiveGateway" -> "Exclusive"). */
function trimBpmnSuffix(typeName: string, bpmnType: string): string {
  const bpmnLocal = toLocalName(bpmnType) ?? bpmnType;
  for (const suffix of STRIPPABLE_SUFFIXES) {
    if (!bpmnLocal.endsWith(suffix)) continue;
    if (typeName === suffix) continue;
    if (typeName.endsWith(suffix) && typeName.length - suffix.length >= 3) {
      return typeName.slice(0, -suffix.length);
    }
  }
  return typeName;
}

function humanizeLabel(typeName: string): string {
  return typeName
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}

function paletteLabel(typeName: string, bpmnType: string): string {
  return humanizeLabel(trimBpmnSuffix(typeName, bpmnType));
}

function deriveCategory(moddle: any, bpmnType: string): string | null {
  const ancestors: string[] = (getBpmnTypeDefinition(moddle, bpmnType)?.allTypes ?? [])
    .map((typeDef: any) => typeDef.name);
  for (const { ancestor, category } of CATEGORY_RULES) {
    if (ancestors.includes(ancestor)) return category;
  }
  return null;
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
  extensionType: string;
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

export function runResolvePaletteSchemas(
  modeler: any,
  _command: ResolvePaletteSchemasCommand,
): PaletteSchema[] {
  const moddle = modeler.get('moddle');
  const popupMenu = modeler.get('popupMenu');
  const elementTemplates = modeler.get('elementTemplates');

  if (!filteredPopupMenus.has(popupMenu)) {
    new (RemoveTemplatesFromPopup as any)(popupMenu);
    filteredPopupMenus.add(popupMenu);
  }

  const schemas: PaletteSchema[] = moddle.getPackages()
    .map((pkg: any): PaletteSchema | null => {
      const prefix = pkg.prefix?.toLowerCase();
      if (!prefix || NON_USER_PREFIXES.has(prefix)) return null;

      const items: PaletteItem[] = (pkg.types || [])
        .filter((type: any) => !isHiddenFromPalette(type))
        .flatMap((type: any): PaletteItem[] => {
          const bpmnType = resolveBpmnCreateType(moddle, type);
          if (!bpmnType) return [];
          const explicitCategories = type.meta?.categories;
          const categories = Array.isArray(explicitCategories) && explicitCategories.length > 0
            ? explicitCategories
            : [deriveCategory(moddle, bpmnType)].filter((c): c is string => c !== null);
          return [{
            label: paletteLabel(type.name, bpmnType),
            bpmnType,
            extensionType: `${pkg.prefix}:${type.name}`,
            icon: typeof type.meta?.icon === 'string'
              ? type.meta.icon
              : resolveFallbackIcon(moddle, bpmnType),
            categories,
          }];
        });

      const templates: PaletteTemplate[] = (elementTemplates?.getBySchemaPrefix?.(prefix) ?? [])
        .map((template: ElementTemplate) => ({
          id: template.id,
          label: template.name,
          description: template.description,
          icon: template.iconClass,
          bpmnType: template.bpmnType,
          extensionType: template.extensionType,
        }));

      const meta = SCHEMAS.find((s) => s.prefix === prefix);
      return {
        prefix,
        name: typeof pkg.name === 'string' && pkg.name.trim().length > 0 ? pkg.name : prefix,
        icon: typeof pkg.icon === 'string' ? pkg.icon : undefined,
        core: meta?.core === true,
        items,
        templates,
      };
    })
    .filter((s: PaletteSchema | null): s is PaletteSchema => s !== null);

  return schemas.sort((a, b) => {
    const ai = schemaOrder.get(a.prefix) ?? Number.MAX_SAFE_INTEGER;
    const bi = schemaOrder.get(b.prefix) ?? Number.MAX_SAFE_INTEGER;
    return ai !== bi ? ai - bi : a.prefix.localeCompare(b.prefix);
  });
}
