import type { CommandContext } from './types';
import { SCHEMA_NAMES } from '../contexts';
import SchemaPopupMenu from '../palette/SchemaPopupMenu';
import RemoveTemplatesFromPopup from '../palette/RemoveTemplatesFromPopup';

const filteredPopupMenus = new WeakSet<object>();
const schemaOrder = new Map(SCHEMA_NAMES.map((schemaName, index) => [schemaName, index]));

export type PaletteSchemaDescriptor = {
  prefix: string;
  icon?: string;
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

    schemas.push({
      prefix,
      icon: typeof pkg.icon === 'string' ? pkg.icon : undefined,
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
