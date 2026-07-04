/**
 * NIDM-Results exporter (Turtle / ProvONE-style).
 *
 * Exports the analysis subprocess: each DataOperation activity (Map/Filter/
 * Reduce/etc.) becomes a `prov:Activity`, and each Dataset/Table referenced
 * as input or output becomes a `prov:Entity` with `prov:used` /
 * `prov:wasGeneratedBy` associations. Non-analysis activities are skipped.
 *
 * Output is a minimal Turtle document that loads in any RDF tool; it contains
 * `nidm:` predicates where applicable but it's just a starting point for a
 * human reviewer.
 */

import { getDiagramName } from '../diagramName';
import { forEachBusinessObject, readField } from './common';

const PREFIXES = `@prefix prov:  <http://www.w3.org/ns/prov#> .
@prefix nidm:  <http://purl.org/nidash/nidm#> .
@prefix core: <https://behaverse.org/schemas/studyflow/> .
@prefix bpmn:  <http://www.omg.org/spec/BPMN/20100524/MODEL/> .
@prefix dct:   <http://purl.org/dc/terms/> .
@prefix rdfs:  <http://www.w3.org/2000/01/rdf-schema#> .
@prefix xsd:   <http://www.w3.org/2001/XMLSchema#> .
`;

type Activity = { id: string; name: string; type: string; operation?: string; documentation?: string; inputs: string[]; outputs: string[]; };
type Entity = { id: string; name: string; type: string; format?: string };

const DATA_ELEMENT_TYPES = new Set([
  'studyflow:Dataset',
  'studyflow:Table',
  'studyflow:Array',
  'studyflow:Schema',
  'studyflow:Snapshot',
  'studyflow:Timeseries',
  'studyflow:EventMarker',
]);

function isDataOperationActivity(bo: any): boolean {
  if (!bo) return false;
  // Studyflow's DataOperationActivity uses an `isDataOperation` flag plus an
  // `operation` enum value. Either being set marks this as an analysis step.
  if (readField(bo, 'isDataOperation') === true || readField(bo, 'isDataOperation') === 'true') return true;
  if (readField(bo, 'operation')) return true;
  // The `datatrove:` schema declares concrete operators (Transform/Map/Filter/
  // Reader/Writer/...); `omniprocess:` declares the brain preprocessing pipelines.
  return typeof bo.$type === 'string'
    && (bo.$type.startsWith('datatrove:') || bo.$type.startsWith('omniprocess:'));
}

function turtleId(id: string): string {
  return `core:${id.replace(/[^A-Za-z0-9_]/g, '_')}`;
}

function escape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

export function exportToNidm(modeler: any): string {
  const diagramName = getDiagramName(modeler) ?? 'studyflow_export';

  const activities: Activity[] = [];
  const entities = new Map<string, Entity>();

  forEachBusinessObject(modeler, (bo) => {
    if (DATA_ELEMENT_TYPES.has(bo.$type)) {
      entities.set(bo.id, {
        id: bo.id,
        name: bo.name || bo.id,
        type: bo.$type,
        format: readField(bo, 'format') as string | undefined,
      });
      return;
    }

    if (isDataOperationActivity(bo)) {
      const inputs: string[] = [];
      const outputs: string[] = [];
      // Collect data associations (BPMN dataInputAssociations / dataOutputAssociations).
      const inAssoc = bo.get?.('dataInputAssociations') ?? bo.dataInputAssociations ?? [];
      for (const a of inAssoc) {
        for (const ref of a.get?.('sourceRef') ?? a.sourceRef ?? []) {
          if (ref?.id) inputs.push(ref.id);
        }
      }
      const outAssoc = bo.get?.('dataOutputAssociations') ?? bo.dataOutputAssociations ?? [];
      for (const a of outAssoc) {
        const tgt = a.get?.('targetRef') ?? a.targetRef;
        if (tgt?.id) outputs.push(tgt.id);
      }
      activities.push({
        id: bo.id,
        name: bo.name || bo.id,
        type: bo.$type,
        operation: readField(bo, 'operation') as string | undefined,
        documentation: readField(bo, 'documentation') as string | undefined,
        inputs,
        outputs,
      });
    }
  });

  if (activities.length === 0 && entities.size === 0) {
    return `${PREFIXES}
# No data-operation activities or data-plane elements found in this diagram.
# Add a Transform / Map / Filter / Reduce task wired to a Dataset to populate this export.

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

  for (const ent of entities.values()) {
    const lex: string[] = [];
    lex.push(`${turtleId(ent.id)} a prov:Entity , core:${ent.type.split(':')[1]} ;`);
    lex.push(`  rdfs:label "${escape(ent.name)}"`);
    if (ent.format) lex.push(` ;\n  nidm:format "${escape(ent.format)}"`);
    lex[lex.length - 1] += ' .';
    lines.push(lex.join(''));
    lines.push('');
  }

  for (const act of activities) {
    const lex: string[] = [];
    lex.push(`${turtleId(act.id)} a prov:Activity , core:${act.type.split(':')[1] || 'Activity'} ;`);
    lex.push(`  rdfs:label "${escape(act.name)}"`);
    if (act.operation) lex.push(` ;\n  studyflow:operation "${escape(act.operation)}"`);
    if (act.documentation) lex.push(` ;\n  rdfs:comment "${escape(act.documentation)}"`);
    for (const inp of act.inputs) {
      lex.push(` ;\n  prov:used ${turtleId(inp)}`);
    }
    lex[lex.length - 1] += ' .';
    lines.push(lex.join(''));

    // For each output, emit a reverse `prov:wasGeneratedBy`.
    for (const out of act.outputs) {
      lines.push(`${turtleId(out)} prov:wasGeneratedBy ${turtleId(act.id)} .`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
