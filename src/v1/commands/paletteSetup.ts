import type { CommandContext } from './types';
import SchemaCreateMenuProvider from '../palette/SchemaCreateMenuProvider';

export type PaletteRegisterSchemaProvidersCommand = {
  type: 'palette-register-schema-providers';
  registeredSchemas: Set<string>;
};

export function runPaletteRegisterSchemaProviders(
  context: CommandContext,
  command: PaletteRegisterSchemaProvidersCommand,
): string[] {
  if (!context.modeler) {
    throw new Error("Command 'palette-register-schema-providers' requires a modeler instance.");
  }

  const bpmnFactory = context.modeler.get('bpmnFactory');
  const moddle = bpmnFactory._model;
  const popupMenu = context.modeler.get('popupMenu');
  const elementFactory = context.modeler.get('elementFactory');
  const create = context.modeler.get('create');

  const prefixes: string[] = [];

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
        new (SchemaCreateMenuProvider as any)(
          popupMenu,
          bpmnFactory,
          elementFactory,
          create,
          prefix,
        );
        command.registeredSchemas.add(prefix);
      } catch {
        return;
      }
    }

    prefixes.push(prefix);
  });

  prefixes.sort();
  return prefixes;
}
