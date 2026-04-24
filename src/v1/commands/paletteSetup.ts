import type { CommandContext } from './types';
import { SCHEMA_NAMES } from '../contexts';
import SchemaPopupMenu from '../palette/SchemaPopupMenu';
import RemoveTemplatesFromPopup from '../palette/RemoveTemplatesFromPopup';
import { resolveBpmnCreateType } from '../moddle/resolveBpmnType';

const filteredPopupMenus = new WeakSet<object>();
const schemaOrder = new Map(SCHEMA_NAMES.map((schemaName, index) => [schemaName, index]));

const HIDDEN_TYPES = new Set(['Study', 'StartEvent', 'EndEvent', 'SequenceFlow']);
const PRIMITIVE_TYPES = ['String', 'Boolean', 'Integer', 'Float', 'Double'];

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

export type PaletteSchemaDescriptor = {
  prefix: string;
  icon?: string;
  items: PaletteSchemaItem[];
};

export type PaletteRegisterSchemaProvidersCommand = {
  type: 'palette-register-schema-providers';
  registeredSchemas: Set<string>;
};

export function runPaletteRegisterSchemaProviders(
  context: CommandContext,
  command: PaletteRegisterSchemaProvidersCommand,
): PaletteSchemaDescriptor[] {
  if (!context.modeler) {
    throw new Error("Command 'palette-register-schema-providers' requires a modeler instance.");
  }

  const bpmnFactory = context.modeler.get('bpmnFactory');
  const moddle = bpmnFactory._model;
  const popupMenu = context.modeler.get('popupMenu');
  const elementFactory = context.modeler.get('elementFactory');
  const create = context.modeler.get('create');
  const elementTemplates = context.modeler.get('elementTemplates');

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

    if (!command.registeredSchemas.has(prefix)) {
      try {
        // eslint-disable-next-line no-new
        new (SchemaPopupMenu as any)(
          popupMenu,
          bpmnFactory,
          elementFactory,
          create,
          elementTemplates,
          prefix,
        );
        command.registeredSchemas.add(prefix);
      } catch {
        return;
      }
    }

    const items: PaletteSchemaItem[] = (pkg.types || [])
      .filter((type: any) => {
        if (type.isAbstract || HIDDEN_TYPES.has(type.name)) return false;
        if (type.superClass?.some((sc: string) => PRIMITIVE_TYPES.includes(sc))) return false;
        if (Array.isArray(type.meta?.flowElements) && type.meta.flowElements.length > 0) return false;
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
          label: type.name,
          bpmnType,
          studyflowType: `${pkg.prefix}:${type.name}`,
          icon: typeof type.meta?.icon === 'string' ? type.meta.icon : undefined,
          categories,
        };
      })
      .filter((entry: PaletteSchemaItem | null): entry is PaletteSchemaItem => entry !== null);

    schemas.push({
      prefix,
      icon: typeof pkg.icon === 'string' ? pkg.icon : undefined,
      items,
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
