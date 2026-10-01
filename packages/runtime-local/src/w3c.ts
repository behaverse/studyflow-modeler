/**
 * A run's record as W3C PROV. The `prov:` records a run writes into the study are Studyflow's own vocabulary
 * (`https://w3id.org/studyflow/prov`, prov.moddle.yaml), not W3C's; this maps the run's one record, its
 * `events.jsonl` (packages/core/src/engine/record.ts), onto PROV-O (https://www.w3.org/TR/prov-o/), in Turtle:
 *
 * - a run is a `prov:Activity`, associated with the person who ran it and the tool, under the study as its
 *   `prov:Plan` (named by its protocol digest);
 * - each step that ran, event passed, gateway decided or answer a pool gave is a `prov:Activity` of its own, part of
 *   the run, whose plan is the element of the study (`<plan>#<id>`); a skipped step, reused from an earlier run, is one
 *   influenced by that run;
 * - each value written, message sent and file made is a `prov:Entity` the run generated, and each file staged in one
 *   it used.
 *
 * What PROV has no term for keeps a term of Studyflow's (`sf:`): a step's status, the flow a gateway took, the flow a
 * message went along, the property a value was written to. The counts are the study's state, not provenance, and
 * are left out.
 */
import type { RunEvent } from '@core/engine';

const PREFIXES = `@prefix prov: <http://www.w3.org/ns/prov#> .
@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix dcterms: <http://purl.org/dc/terms/> .
@prefix sf: <https://w3id.org/studyflow/prov#> .
`;

const literal = (text: string): string => JSON.stringify(text);
const time = (at: string): string => `${literal(at)}^^xsd:dateTime`;
const iri = (text: string): string => `<${encodeURI(text).replace(/[<>"{}|\\^`]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}>`;
/** A value as Turtle writes it: a number, a boolean or a string as itself, anything else as its JSON text. */
const json = (value: unknown): string => (typeof value === 'number' && Number.isFinite(value)) || typeof value === 'boolean'
  ? String(value) : literal(typeof value === 'string' ? value : JSON.stringify(value) ?? 'null');

/** The PROV-O, in Turtle, of every run in `events` (a repository's record holds each run it redid, in order). */
export function provOf(events: readonly RunEvent[]): string {
  const out: string[] = [PREFIXES];
  const agents = new Map<string, string>();
  let run = '';
  let plan = '';
  let n = 0;
  const node = (kind: string): string => iri(`${run}/${kind}/${n += 1}`);
  const agent = (kind: 'Person' | 'SoftwareAgent', name: string): string => {
    const id = iri(`urn:studyflow:agent:${name}`);
    if (!agents.has(id)) {
      agents.set(id, kind);
      out.push(`${id} a prov:Agent, prov:${kind} ;\n  rdfs:label ${literal(name)} .\n`);
    }
    return id;
  };
  const step = (id: string, label: string, lines: string[]): void => {
    const element = iri(`${plan}#${id}`);
    out.push([`${node('step')} a prov:Activity ;`, `  rdfs:label ${literal(label)} ;`, `  dcterms:isPartOf ${iri(run)} ;`,
      `  prov:qualifiedAssociation [ a prov:Association ; prov:hadPlan ${element} ] ;`, ...lines].join('\n').replace(/ ;$/, ' .') + '\n');
  };

  for (const happened of events) {
    switch (happened.event) {
      case 'started': {
        const stamp = happened.stamp as Record<string, string>;
        run = `urn:studyflow:run:${happened.run}:${happened.at}`;
        plan = `urn:studyflow:plan:${stamp.plan ?? 'unsealed'}`;
        n = 0;
        const who = stamp.who ? agent('Person', stamp.who) : undefined;
        const tool = stamp.with ? agent('SoftwareAgent', stamp.with) : undefined;
        out.push(`${iri(plan)} a prov:Entity, prov:Plan ;\n  rdfs:label ${literal(stamp.plan ?? 'unsealed')} .\n`);
        out.push([`${iri(run)} a prov:Activity ;`, `  rdfs:label ${literal(`run ${happened.run}`)} ;`,
          `  prov:startedAtTime ${time(happened.at)} ;`, `  prov:used ${iri(plan)} ;`,
          ...[who, tool].filter(Boolean).map((id) => `  prov:wasAssociatedWith ${id} ;`),
          `  prov:qualifiedAssociation [ a prov:Association ; prov:agent ${tool ?? who ?? iri('urn:studyflow:agent:unknown')} ; prov:hadPlan ${iri(plan)} ] ;`,
          ...(stamp.seed === undefined ? [] : [`  sf:seed ${json(stamp.seed)} ;`])].join('\n').replace(/ ;$/, ' .') + '\n');
        break;
      }
      case 'executed':
      case 'failed': {
        const { entry } = happened;
        step(happened.id, entry?.name || happened.id, [
          ...(entry?.type ? [`  dcterms:type ${literal(entry.type)} ;`] : []),
          ...(entry?.startedAt ? [`  prov:startedAtTime ${time(entry.startedAt)} ;`] : []),
          `  prov:endedAtTime ${time(happened.at)} ;`,
          `  sf:status ${literal(happened.event === 'failed' ? 'failed' : String(entry?.status ?? 'ok'))} ;`,
          ...(happened.event === 'executed' && happened.flow ? [`  sf:took ${iri(`${plan}#${happened.flow}`)} ;`] : []),
        ]);
        break;
      }
      case 'answered':
        step(happened.id, `${happened.entry.name || happened.id} answered`, [
          ...(happened.entry.startedAt ? [`  prov:startedAtTime ${time(happened.entry.startedAt)} ;`] : []),
          `  prov:endedAtTime ${time(happened.at)} ;`, `  sf:status ${literal(String(happened.entry.status))} ;`,
        ]);
        break;
      case 'reused': {
        const earlier = iri(`urn:studyflow:run:${happened.run}`);
        step(happened.id, `${happened.id} reused`, [`  prov:endedAtTime ${time(happened.at)} ;`, `  sf:status "reused" ;`,
          `  prov:wasInfluencedBy ${earlier} ;`, ...(happened.flow ? [`  sf:took ${iri(`${plan}#${happened.flow}`)} ;`] : [])]);
        break;
      }
      case 'wrote':
        out.push([`${node('value')} a prov:Entity ;`, `  rdfs:label ${literal(happened.name)} ;`,
          `  sf:property ${iri(`${plan}#${happened.scope}`)} ;`, ...('value' in happened ? [`  prov:value ${json(happened.value)} ;`] : []),
          `  prov:generatedAtTime ${time(happened.at)} ;`, `  prov:wasGeneratedBy ${iri(run)} .`].join('\n') + '\n');
        break;
      case 'sent': {
        const { message } = happened;
        out.push([`${iri(`${run}/message/${message.id}`)} a prov:Entity ;`, `  sf:flow ${iri(`${plan}#${message.flow}`)} ;`,
          `  prov:value ${json(message.content)} ;`, `  prov:generatedAtTime ${time(happened.at)} ;`,
          ...(message.inReplyTo ? [`  prov:wasDerivedFrom ${iri(`${run}/message/${message.inReplyTo}`)} ;`] : []),
          `  prov:wasGeneratedBy ${iri(run)} .`].join('\n') + '\n');
        break;
      }
      case 'created':
      case 'imported': {
        const file = iri(`${run}/file/${happened.uri}`);
        out.push(`${file} a prov:Entity ;\n  rdfs:label ${literal(happened.uri)} ;\n  sf:element ${iri(`${plan}#${happened.id}`)} .\n`);
        out.push(happened.event === 'created'
          ? `${file} prov:wasGeneratedBy ${iri(run)} ;\n  prov:generatedAtTime ${time(happened.at)} .\n`
          : `${iri(run)} prov:used ${file} .\n`);
        break;
      }
      case 'finished':
        out.push(`${iri(run)} prov:endedAtTime ${time(happened.at)} ;\n  sf:status ${literal(happened.status)} .\n`);
        break;
      default:
    }
  }
  return out.join('\n');
}
