import { LinkMLToModdleConverter } from './converter';
import type { ModdleSchema } from './types';

/**
 * Modeler-only adapter: convert LinkML YAML schema to BPMN moddle package.
 */
export function toModelerModdleSchema(linkmlYamlContent: string): ModdleSchema {
  const converter = new LinkMLToModdleConverter(linkmlYamlContent);
  converter.convert();
  return converter.getSchema();
}

export { LinkMLToModdleConverter };
export type { ModdleSchema };
