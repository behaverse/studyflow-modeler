/**
 * What a study makes, as data an AI reads to spell `add`, `append` and `replace`: the BPMN types it adds as shapes,
 * the schema types extending them, and the templates the installed schemas offer.
 */

import { getCatalog, hasCatalog } from '@core/notation/index.ts';

/** The BPMN types a study adds as shapes: what `add`, `append` and `replace` take as `type`. */
export const SHAPE_TYPES = [
  'bpmn:StartEvent', 'bpmn:IntermediateCatchEvent', 'bpmn:IntermediateThrowEvent', 'bpmn:BoundaryEvent', 'bpmn:EndEvent',
  'bpmn:Task', 'bpmn:UserTask', 'bpmn:ManualTask', 'bpmn:ServiceTask', 'bpmn:ScriptTask', 'bpmn:BusinessRuleTask',
  'bpmn:SendTask', 'bpmn:ReceiveTask', 'bpmn:CallActivity', 'bpmn:SubProcess', 'bpmn:ChoreographyTask',
  'bpmn:ExclusiveGateway', 'bpmn:ParallelGateway', 'bpmn:InclusiveGateway', 'bpmn:ComplexGateway', 'bpmn:EventBasedGateway',
  'bpmn:DataObjectReference', 'bpmn:DataStoreReference', 'bpmn:Group', 'bpmn:TextAnnotation', 'bpmn:Participant',
] as const;

/** A shape to make: its `type`, and the schema type extending it as `extension`, as `add` takes them; the words aside, an argument for `add`. */
export interface CatalogType {
  readonly type: string;
  readonly extension?: string;
  readonly title?: string;
  readonly description?: string;
}

/** A template to drop, by the id `add` and `append` take as `template`. */
export interface CatalogTemplate {
  readonly template: string;
  readonly title: string;
  readonly description?: string;
}

export interface Catalog {
  readonly types: readonly CatalogType[];
  readonly templates: readonly CatalogTemplate[];
}

/**
 * The BPMN shape types, then each installed schema type that extends one (neither abstract nor a trait), then the
 * templates: of the schemas whose prefix `reads` (a study's moddle), for only those can its document hold.
 */
export function installedCatalog(reads: (prefix: string) => boolean): Catalog {
  const plain = SHAPE_TYPES.map((type) => ({ type }));
  if (!hasCatalog()) return { types: plain, templates: [] };
  const shapes: ReadonlySet<string> = new Set(SHAPE_TYPES);
  const schemas = getCatalog().schemas.filter((schema) => reads(schema.prefix));
  const extensions = schemas.flatMap((schema) => schema.types)
    .filter((entry) => entry.bpmnType && shapes.has(entry.bpmnType) && !entry.isAbstract && entry.style !== 'trait')
    .map((entry): CatalogType => ({
      type: entry.bpmnType!,
      extension: entry.name,
      title: entry.paletteLabel,
      ...(entry.description ? { description: entry.description } : {}),
    }));
  const templates = schemas.flatMap((schema) => schema.templates).map((template): CatalogTemplate => ({
    template: template.id,
    title: template.name,
    ...(template.description ? { description: template.description } : {}),
  }));
  return { types: [...plain, ...extensions], templates };
}
