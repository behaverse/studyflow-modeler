import * as yaml from 'js-yaml';
import type { SchemaModel } from './model';

/**
 * moddle-YAML front-end: parses a `*.moddle.yaml` schema into the IR.
 *
 * The authored YAML shape is isomorphic to `SchemaModel`, so this is parse +
 * sanity checks. Unknown keys ride along untouched — `toModdlePackages` must
 * reproduce the file's intent byte-for-byte for the XML codec.
 */
export function fromModdleYaml(yamlText: string): SchemaModel {
  const parsed: any = yaml.load(yamlText);

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Schema YAML did not parse to an object.');
  }
  if (typeof parsed.prefix !== 'string' || typeof parsed.name !== 'string') {
    throw new Error('Schema YAML must declare `name` and `prefix`.');
  }

  return {
    ...parsed,
    types: parsed.types ?? [],
    enumerations: parsed.enumerations ?? [],
  } as SchemaModel;
}
