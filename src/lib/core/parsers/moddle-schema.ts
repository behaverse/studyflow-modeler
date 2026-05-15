import * as yaml from 'js-yaml';

// Parse a moddle YAML schema into the JSON package shape expected by bpmn-moddle.
//
// Every concrete type with a superClass also needs to extend moddle's `Element`,
// so it can be used as a child of `bpmn:ExtensionElements` (whose `values`
// property is typed `Element`). Without this, bpmn-moddle's writer happily
// serializes the wrapper but the parser rejects it on re-load.
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
