import * as yaml from 'js-yaml';

/** Parse a moddle YAML schema; forces every concrete type to extend `Element` so it can live in `bpmn:ExtensionElements`. */
export function toModelerModdleSchema(yamlContent: string): any {
  const schema: any = yaml.load(yamlContent);

  for (const type of schema?.types ?? []) {
    if (Array.isArray(type.superClass) && type.superClass.length > 0
        && !type.superClass.includes('Element')) {
      type.superClass.push('Element');
    }
  }

  return schema;
}
