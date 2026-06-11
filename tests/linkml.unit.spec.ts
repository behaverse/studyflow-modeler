import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { buildCatalog } from '../src/lib/core/catalog';
import { fromLinkml, fromModdleYaml } from '../src/lib/core/schema';

/**
 * LinkML mirror consistency.
 *
 * `studyflow.linkml.yaml` declares itself the source of truth, with the
 * moddle YAML files as mirrors. This suite compiles BOTH through the IR into
 * catalogs and diffs them. Differences are pinned in KNOWN_DIVERGENCES — the
 * checked-in migration TODO list. Anything new (in either file) fails the
 * suite, so the two schema sources can no longer drift silently.
 */

const SCHEMA_DIR = path.join(process.cwd(), 'src/assets/schemas');

const read = (file: string) => readFileSync(path.join(SCHEMA_DIR, file), 'utf8');

const linkmlCatalog = buildCatalog(fromLinkml(read('studyflow.linkml.yaml')));
const moddleCatalog = buildCatalog(
  ['studyflow.moddle.yaml', 'cognitive.moddle.yaml'].map((f) => fromModdleYaml(read(f))),
);

/**
 * Differences between the LinkML source of truth and the moddle mirrors as
 * of 2026-06. Resolving an entry means fixing one of the two schema files
 * (usually the LinkML one) and removing it here. Recurring themes:
 *
 * - `bpmnType bpmn:Activity != bpmn:Task`: the LinkML classes resolve their
 *   canvas type through `is_a` -> Activity; the moddle mirrors pin
 *   `meta.bpmnType: bpmn:Task`. Fix by adding `annotations: {bpmnType: ...}`.
 * - `style wrapper != trait`: StartEvent/EndEvent/Activity/... are moddle
 *   traits (`extends:`, attributes live on the BPMN element) but plain
 *   classes in LinkML (attributes would live on a wrapper). This changes the
 *   serialized XML — decide one style before migrating.
 * - gateways/Actor live under `core:` in LinkML but `cognitive:` in the
 *   moddle mirrors; several enums and attributes exist on only one side.
 */
const KNOWN_DIVERGENCES: string[] = [
  'enum cognitive:ActorTypeEnum: missing in linkml source',
  'enum cognitive:InstrumentEnum: missing in linkml source',
  'enum cognitive:QuestionnaireInstrumentEnum: missing in linkml source',
  'enum studyflow:ActorTypeEnum: missing in moddle mirrors',
  'enum studyflow:BIDSDataTypeEnum: missing in linkml source',
  'enum studyflow:ProbabilityDistributionEnum: missing in linkml source',
  'type cognitive:Actor: missing in linkml source',
  'type cognitive:CognitiveTask: bpmnType bpmn:Activity != bpmn:Task',
  'type cognitive:Configurations: missing in linkml source',
  'type cognitive:EligibilityGateway: missing in linkml source',
  'type cognitive:Instruction: bpmnType bpmn:Activity != bpmn:Task',
  'type cognitive:Questionnaire: bpmnType bpmn:Activity != bpmn:Task',
  'type cognitive:RandomGateway: missing in linkml source',
  'type cognitive:Rest: attributes missing in linkml: instrument',
  'type cognitive:Rest: bpmnType bpmn:Activity != bpmn:Task',
  'type cognitive:StratifiedAllocationGateway: missing in linkml source',
  'type cognitive:VideoGame: bpmnType bpmn:Activity != bpmn:Task',
  'type studyflow:Activity: attributes missing in linkml: inputs, isDataOperation, outputs',
  'type studyflow:Activity: style wrapper != trait',
  'type studyflow:Actor: missing in moddle mirrors',
  'type studyflow:Array: attributes only in linkml: checklist, documentation',
  'type studyflow:Array: bpmnType bpmn:BaseElement != null',
  'type studyflow:BaseElement: missing in linkml source',
  'type studyflow:Checklist: missing in linkml source',
  'type studyflow:DataCatalog: attributes only in linkml: checklist, documentation',
  'type studyflow:DataCatalog: bpmnType bpmn:BaseElement != null',
  'type studyflow:DataObjectReference: missing in linkml source',
  'type studyflow:DataOperationActivity: style wrapper != trait',
  'type studyflow:Dataset: attributes missing in linkml: bidsDataType',
  'type studyflow:Element: missing in moddle mirrors',
  'type studyflow:EligibilityGateway: missing in moddle mirrors',
  'type studyflow:EndEvent: attributes missing in linkml: duration, onset, progress',
  'type studyflow:EndEvent: style wrapper != trait',
  'type studyflow:Event: style wrapper != trait',
  'type studyflow:EventMarker: attributes missing in linkml: state',
  'type studyflow:RandomGateway: missing in moddle mirrors',
  'type studyflow:Schema: attributes missing in linkml: state',
  'type studyflow:SequenceFlow: missing in linkml source',
  'type studyflow:Snapshot: attributes only in linkml: checklist, documentation',
  'type studyflow:Snapshot: bpmnType bpmn:BaseElement != null',
  'type studyflow:StartEvent: attributes missing in linkml: duration, onset, progress',
  'type studyflow:StartEvent: style wrapper != trait',
  'type studyflow:StratifiedAllocationGateway: missing in moddle mirrors',
  'type studyflow:Study: attributes missing in linkml: isExecutable',
  'type studyflow:Study: attributes only in linkml: name, version',
  'type studyflow:Table: attributes missing in linkml: state',
  'type studyflow:Timeseries: attributes missing in linkml: state',
];

function diffCatalogs(): string[] {
  const out: string[] = [];

  const linkmlTypes = new Map(linkmlCatalog.allTypes().map((t) => [t.name, t]));
  const moddleTypes = new Map(moddleCatalog.allTypes().map((t) => [t.name, t]));

  for (const [name, linkmlType] of linkmlTypes) {
    const moddleType = moddleTypes.get(name);
    if (!moddleType) {
      out.push(`type ${name}: missing in moddle mirrors`);
      continue;
    }
    if (linkmlType.style !== moddleType.style) {
      out.push(`type ${name}: style ${linkmlType.style} != ${moddleType.style}`);
    }
    if (linkmlType.bpmnType !== moddleType.bpmnType) {
      out.push(`type ${name}: bpmnType ${linkmlType.bpmnType} != ${moddleType.bpmnType}`);
    }

    const linkmlAttrs = new Set(linkmlCatalog.instanceAttributesOf(name).map((a) => a.ns.localName));
    const moddleAttrs = new Set(moddleCatalog.instanceAttributesOf(name).map((a) => a.ns.localName));
    const missing = [...moddleAttrs].filter((a) => !linkmlAttrs.has(a)).sort();
    const extra = [...linkmlAttrs].filter((a) => !moddleAttrs.has(a)).sort();
    if (missing.length) out.push(`type ${name}: attributes missing in linkml: ${missing.join(', ')}`);
    if (extra.length) out.push(`type ${name}: attributes only in linkml: ${extra.join(', ')}`);
  }

  for (const name of moddleTypes.keys()) {
    if (!linkmlTypes.has(name)) out.push(`type ${name}: missing in linkml source`);
  }

  const linkmlEnums = new Map(linkmlCatalog.allEnums().map((e) => [e.name, e]));
  const moddleEnums = new Map(moddleCatalog.allEnums().map((e) => [e.name, e]));
  for (const [name, linkmlEnum] of linkmlEnums) {
    const moddleEnum = moddleEnums.get(name);
    if (!moddleEnum) {
      out.push(`enum ${name}: missing in moddle mirrors`);
      continue;
    }
    const a = linkmlEnum.literals.map((l) => l.value).join(',');
    const b = moddleEnum.literals.map((l) => l.value).join(',');
    if (a !== b) out.push(`enum ${name}: literals [${a}] != [${b}]`);
  }
  for (const name of moddleEnums.keys()) {
    if (!linkmlEnums.has(name)) out.push(`enum ${name}: missing in linkml source`);
  }

  return out.sort();
}

test.describe('linkml mirror consistency', () => {
  test('linkml front-end compiles the source-of-truth schema', () => {
    const prefixes = linkmlCatalog.schemas.map((s) => s.prefix);
    expect(prefixes).toContain('studyflow');
    expect(prefixes).toContain('cognitive');
    expect(linkmlCatalog.allTypes().length).toBeGreaterThan(10);
    expect(linkmlCatalog.allEnums().length).toBeGreaterThan(3);
  });

  test('divergences from the moddle mirrors are pinned', () => {
    expect(diffCatalogs()).toEqual(KNOWN_DIVERGENCES);
  });
});
