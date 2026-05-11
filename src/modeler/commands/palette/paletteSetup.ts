import RemoveTemplatesFromPopup from '../../palette/RemoveTemplatesFromPopup';
import { resolveBpmnCreateType } from '../../moddle/resolveBpmnType';
import { toLocalName } from '../../utils/naming';
import { HIDDEN_SCHEMA_TYPES, PALETTE_GROUPS, PRIMITIVE_MODDLE_TYPES, SCHEMA_NAMES, SCHEMAS } from '../../constants';
import type { Template as ElementTemplate } from '../../moddle/templates/types';

// bpmnType -> icon class
const PALETTE_BPMN_ICONS: Record<string, string> = Object.fromEntries(
  PALETTE_GROUPS.flatMap((group) => group.items.map((item) => [item.bpmnType, item.icon])),
);

function resolveFallbackIcon(moddle: any, bpmnType: string): string | undefined {
  if (PALETTE_BPMN_ICONS[bpmnType]) return PALETTE_BPMN_ICONS[bpmnType];

  let descriptor: any;
  try {
    descriptor = moddle.getType(bpmnType)?.$descriptor;
  } catch {
    return undefined;
  }

  const ancestors: any[] = descriptor?.allTypes ?? [];
  // closest ancestor with an icon.
  for (let i = ancestors.length - 1; i >= 0; i--) {
    const ancestorType = ancestors[i]?.name;
    if (ancestorType && PALETTE_BPMN_ICONS[ancestorType]) {
      return PALETTE_BPMN_ICONS[ancestorType];
    }
  }

  return undefined;
}

const filteredPopupMenus = new WeakSet<object>();
const schemaOrder = new Map(SCHEMA_NAMES.map((schemaName, index) => [schemaName, index]));

// Ordered: earlier matches win. SubProcess is checked before Activity so
// "Containers" takes precedence over "Activities" for subprocess-like shapes.
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

// Strip the BPMN base type suffix
const STRIPPABLE_SUFFIXES = ['Gateway', 'Event'];

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

// Insert spaces for CamelCase / PascalCase
function humanizeLabel(typeName: string): string {
  return typeName
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}

function paletteLabel(typeName: string, bpmnType: string): string {
  return humanizeLabel(trimBpmnSuffix(typeName, bpmnType));
}

function deriveCategory(moddle: any, bpmnType: string): string | null {
  let descriptor: any;
  try {
    descriptor = moddle.getType(bpmnType)?.$descriptor;
  } catch {
    return null;
  }
  const ancestors: string[] = (descriptor?.allTypes ?? []).map((t: any) => t.name);
  for (const { ancestor, category } of CATEGORY_RULES) {
    if (ancestors.includes(ancestor)) return category;
  }
  return null;
}

export type PaletteSchemaItem = {
  label: string;
  bpmnType: string;
  studyflowType: string;
  icon?: string;
  categories: string[];
};

export type PaletteSchemaTemplate = {
  id: string;
  label: string;
  description?: string;
  icon?: string;
  bpmnType: string;
  studyflowType: string;
};

export type PaletteSchemaDescriptor = {
  prefix: string;
  /** Human-readable schema name (`pkg.name`); falls back to the prefix. */
  name: string;
  icon?: string;
  /** True for schemas backing default elements; false for third-party extensions. */
  core: boolean;
  items: PaletteSchemaItem[];
  templates: PaletteSchemaTemplate[];
};

export type PaletteRegisterSchemaProvidersCommand = {
  type: 'palette-register-schema-providers';
};

export function runPaletteRegisterSchemaProviders(
  modeler: any,
  _command: PaletteRegisterSchemaProvidersCommand,
): PaletteSchemaDescriptor[] {
  if (!modeler) {
    throw new Error("Command 'palette-register-schema-providers' requires a modeler instance.");
  }

  const bpmnFactory = modeler.get('bpmnFactory');
  const moddle = bpmnFactory._model;
  const popupMenu = modeler.get('popupMenu');
  const elementTemplates = modeler.get('elementTemplates');

  if (!filteredPopupMenus.has(popupMenu as object)) {
    // eslint-disable-next-line no-new
    new (RemoveTemplatesFromPopup as any)(popupMenu);
    filteredPopupMenus.add(popupMenu as object);
  }

  const schemas: PaletteSchemaDescriptor[] = [];

  const packagesArray: any[] =
    (typeof (moddle as any).getPackages === 'function'
      ? (moddle as any).getPackages()
      : (Array.isArray((moddle as any).packages)
          ? (moddle as any).packages
          : Object.values((moddle as any).packages || {})));

  packagesArray.forEach((pkg: any) => {
    const prefix = pkg.prefix.toLowerCase();
    if (!prefix) return;
    if (['bpmn', 'bpmndi', 'di', 'dc', 'bioc', 'color'].includes(prefix)) return;

    const items: PaletteSchemaItem[] = (pkg.types || [])
      .filter((type: any) => {
        if (type.isAbstract || HIDDEN_SCHEMA_TYPES.has(type.name)) return false;
        if (type.superClass?.some((sc: string) => PRIMITIVE_MODDLE_TYPES.includes(sc))) return false;
        if (Array.isArray(type.meta?.flowElements) && type.meta.flowElements.length > 0) return false;
        if (Array.isArray(type.extends) && type.extends.length > 0
            && (!Array.isArray(type.superClass) || type.superClass.length === 0)) return false;
        // Template-scoped types are surfaced via their `templates:` entry only;
        // hide them from palette flyovers so users always reach for the
        // prefilled template instead of a bare type instance.
        if (type.meta?.templateScopedType) return false;
        return true;
      })
      .map((type: any): PaletteSchemaItem | null => {
        const bpmnType = resolveBpmnCreateType(moddle, type);
        if (!bpmnType) return null;
        const derived = deriveCategory(moddle, bpmnType);
        const categories = Array.isArray(type.meta?.categories) && type.meta.categories.length > 0
          ? type.meta.categories
          : (derived ? [derived] : []);
        return {
          label: paletteLabel(type.name, bpmnType),
          bpmnType,
          studyflowType: `${pkg.prefix}:${type.name}`,
          icon: typeof type.meta?.icon === 'string'
            ? type.meta.icon
            : resolveFallbackIcon(moddle, bpmnType),
          categories,
        };
      })
      .filter((entry: PaletteSchemaItem | null): entry is PaletteSchemaItem => entry !== null);

    const templates: PaletteSchemaTemplate[] = (
      typeof elementTemplates?.getBySchemaPrefix === 'function'
        ? elementTemplates.getBySchemaPrefix(prefix)
        : []
    ).map((template: ElementTemplate) => ({
      id: template.id,
      label: template.name,
      description: template.description,
      icon: template.iconClass,
      bpmnType: template.bpmnType,
      studyflowType: template.studyflowType,
    }));

    const descriptor = SCHEMAS.find((s) => s.prefix === prefix);
    schemas.push({
      prefix,
      name: typeof pkg.name === 'string' && pkg.name.trim().length > 0 ? pkg.name : prefix,
      icon: typeof pkg.icon === 'string' ? pkg.icon : undefined,
      core: descriptor?.core === true,
      items,
      templates,
    });
  });

  schemas.sort((left, right) => {
    const leftIndex = schemaOrder.get(left.prefix) ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = schemaOrder.get(right.prefix) ?? Number.MAX_SAFE_INTEGER;

    if (leftIndex !== rightIndex) {
      return leftIndex - rightIndex;
    }

    return left.prefix.localeCompare(right.prefix);
  });
  return schemas;
}
