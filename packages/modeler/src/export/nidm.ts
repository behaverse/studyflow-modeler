import { toLocalName } from '@core/naming';
import type { ExportedElement, ExportModel } from '@modeler/export/model';

const PREFIXES = `@prefix prov:  <http://www.w3.org/ns/prov#> .
@prefix nidm:  <http://purl.org/nidash/nidm#> .
@prefix core: <https://behaverse.org/schemas/studyflow/> .
@prefix bpmn:  <http://www.omg.org/spec/BPMN/20100524/MODEL/> .
@prefix dct:   <http://purl.org/dc/terms/> .
@prefix rdfs:  <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd:   <http://www.w3.org/2001/XMLSchema#> .
`;

function turtleId(id: string): string {
  return `core:${id.replace(/[^A-Za-z0-9_]/g, '_')}`;
}

function turtleClass(type: string | undefined, fallback: string): string {
  return `core:${toLocalName(type) || fallback}`;
}

function escape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function text(element: ExportedElement, name: string): string | undefined {
  const value = element.attributes[name];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

export function exportToNidm(model: ExportModel): string {
  const diagramName = model.diagramName;

  const entities = model.dataElements;
  const activities = model.operations.filter((activity) => !model.dataElementIds.has(activity.id));

  if (activities.length === 0 && entities.length === 0) {
    return `${PREFIXES}
# No data-operation activities or data-plane elements found in this diagram.
# Add a service task with an implementation associated with a Dataset to populate this export.

<#diagram> a prov:Bundle ;
  dct:title "${escape(diagramName)}" ;
  rdfs:comment "Empty NIDM-Results export." .
`;
  }

  const lines: string[] = [PREFIXES, ''];
  lines.push(`<#diagram> a prov:Bundle ;`);
  lines.push(`  dct:title "${escape(diagramName)}" ;`);
  lines.push(`  rdfs:comment "Studyflow analysis subprocess exported in NIDM-Results-aligned Turtle." .`);
  lines.push('');

  for (const ent of entities) {
    const lex: string[] = [];
    lex.push(`${turtleId(ent.id)} a prov:Entity , ${turtleClass(ent.type, 'Entity')} ;`);
    lex.push(`  rdfs:label "${escape(ent.name)}"`);
    const format = text(ent, 'format');
    if (format) lex.push(` ;\n  nidm:format "${escape(format)}"`);
    lex[lex.length - 1] += ' .';
    lines.push(lex.join(''));
    lines.push('');
  }

  for (const act of activities) {
    const lex: string[] = [];
    lex.push(`${turtleId(act.id)} a prov:Activity , ${turtleClass(act.type, 'Activity')} ;`);
    lex.push(`  rdfs:label "${escape(act.name)}"`);
    const implementation = text(act, 'implementation');
    if (implementation) lex.push(` ;\n  core:implementation "${escape(implementation)}"`);
    if (act.documentation) lex.push(` ;\n  rdfs:comment "${escape(act.documentation)}"`);
    for (const inp of act.inputs) {
      lex.push(` ;\n  prov:used ${turtleId(inp)}`);
    }
    lex[lex.length - 1] += ' .';
    lines.push(lex.join(''));

    for (const out of act.outputs) {
      lines.push(`${turtleId(out)} prov:wasGeneratedBy ${turtleId(act.id)} .`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
