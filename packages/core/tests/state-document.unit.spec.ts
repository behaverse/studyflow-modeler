import { expect, test } from '@playwright/test';
import * as yaml from 'js-yaml';

import { xmlToStudy } from '@core/document';
import { YAML_DUMP_OPTIONS } from '@core/model/spelling';
import { resolvePlaceholdersIn, resolveStateIn, type StateTree } from '@core/model/state';
import { freshMetamodel, studyModel, xmlOf, yamlOf } from '@tests/schemas';

/** `state:` is the retrospective tree (docs/reference.qmd, "Run state"): JSON on the Study extension in the XML, a mapping in the file. */

const STATE = {
  _meta: {
    prov: [{ action: 'executed', when: '2026-09-04T10:00:00Z', who: 'alice' }],
    reached: { Battery: 1, F1: 1, Excluded_Pre: 4 },
  },
  Example_Study: { arm: 'A' },
  Battery: { failed_trials: 2 },
  Excluded_Pre: { count: 3 },
};

const STATE_BLOCK = yaml.dump({ state: STATE }, YAML_DUMP_OPTIONS);

const BODY = `id: state_probe
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Example_Study:
  type: bpmn:Process
  properties:
    P_Arm:
      name: arm
  flowElements:
    Battery:
      type: bpmn:SubProcess
      properties:
        P_Failed:
          name: failed_trials
          value: 0
      flowElements:
        Trial:
          type: bpmn:Task
    Excluded_Pre:
      type: bpmn:EndEvent
      name: Excluded (n={count})
      properties:
        P_Count:
          name: count
          value: 0
    F1:
      type: bpmn:SequenceFlow
      sourceRef: Battery
      targetRef: Excluded_Pre
`;

const DOC = BODY + STATE_BLOCK;

test.describe('state in the document', () => {
  test('YAML -> XML -> YAML keeps state: byte-identical, and the XML holds it as JSON', async () => {
    const xml = await xmlOf(DOC);
    const json = xml.match(/<studyflow:study>\s*<studyflow:state>(\{.*\})<\/studyflow:state>/s)?.[1] ?? '';
    expect(JSON.parse(json.replace(/&quot;/g, '"').replace(/&amp;/g, '&'))).toEqual(STATE);
    expect(xml).toContain('studyflow:value="0"');

    expect((await xmlToStudy(xml, freshMetamodel())).study.state).toEqual(STATE);
    expect((await yamlOf(xml)).endsWith(STATE_BLOCK)).toBe(true);
  });

  test('a lookup reads the element, its containers out to the study root, and its own runner counter', () => {
    const model = studyModel(DOC);
    const CASES: [elementId: string, path: string, expected: unknown][] = [
      ['Excluded_Pre', 'count', 3],
      ['Trial', 'failed_trials', 2], // Battery's, its container
      ['Trial', 'arm', 'A'], // the study root's
      ['Example_Study', 'arm', 'A'],
      ['Trial', 'count', undefined], // a sibling's is out of scope
      ['Nope', 'count', undefined],
      // A lone `{reached}` is the element's own counter, and an element no run reached counts 0, never its container's.
      ['Excluded_Pre', 'reached', 4],
      ['Trial', 'reached', 0], // inside Battery, which was reached once; Trial itself never was
      ['Example_Study', 'reached', 0],
      ['F1', 'reached', 1], // a sequence flow is found, and counted, like a node
      ['Excluded_Pre', 'reached.Battery', undefined],
      // `state.` reads the tree from its top, `_meta` included.
      ['Trial', 'state.Excluded_Pre.count', 3],
      ['Trial', 'state.Example_Study.arm', 'A'],
      ['Trial', 'state._meta.reached.Excluded_Pre', 4],
      ['Trial', 'state._meta.prov.0.who', 'alice'],
    ];
    for (const [elementId, path, expected] of CASES) {
      expect(resolveStateIn(model, elementId, path), `${elementId}: ${path}`).toBe(expected);
    }
  });

  test('a placeholder is substituted where it resolves and left as written where it does not', () => {
    const CASES: [label: string, state: StateTree | undefined, text: string, expected: string][] = [
      ['a name in scope', STATE, 'Excluded (n={count})', 'Excluded (n=3)'],
      ['an unresolved name stays', STATE, '{arm}/{missing} {reached} {state.Battery.failed_trials}', 'A/{missing} 4 2'],
      ['without state, the value the file declares', undefined, 'Excluded (n={count})', 'Excluded (n=0)'],
      ['a name declared with no value stays', undefined, '{arm}', '{arm}'],
      // A deposited file no run has touched reads n=0, as a preregistered exit nobody took should.
      ['a counter with no run behind it is 0', undefined, 'Excluded (n={reached})', 'Excluded (n=0)'],
      ['only the braces of a name: YAML and JSON in a value stay put', STATE, '{a: 1} {"arm": 2} {arm}', '{a: 1} {"arm": 2} A'],
      // As in the Python runners.
      ['a name of letters of any script, and hyphens', { Example_Study: { durée: 3 }, _meta: { reached: { 'sid-12': 4 } } }, '{durée} {state._meta.reached.sid-12}', '3 4'],
    ];
    for (const [label, state, text, expected] of CASES) {
      const model = studyModel(BODY + (state ? yaml.dump({ state }, YAML_DUMP_OPTIONS) : ''));
      expect(resolvePlaceholdersIn(model, text, 'Excluded_Pre'), label).toBe(expected);
    }
  });

  test('before any run, a placeholder reads the value the file declares, and :% draws a number as a percentage', () => {
    // A threshold on the process, decision rules wired into a sub-process, settings wired into a task.
    const declared = `id: declared_probe
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Subjects:
  type: Process
  properties:
    P_Max:
      name: max_unanswered
      value: 0.2
    P_Arm:
      name: arm
      value: none
  flowElements:
    Play:
      type: Task
      dataInputAssociations:
        In_Pace:
          sourceRef:
            - Pace
    Pace:
      type: studyflow:Parameters
      values:
        speed: 5
    Analysis:
      type: SubProcess
      properties:
        P_Arm_Inner:
          name: arm
          value: cautious
      dataInputAssociations:
        In_Rules:
          sourceRef:
            - Rules
      flowElements:
        Test:
          type: ExclusiveGateway
    Rules:
      type: studyflow:Parameters
      values:
        alpha: 0.05
        rules:
          min_per_arm: 4
`;
    const CASES: [label: string, state: StateTree | undefined, elementId: string, text: string, expected: string][] = [
      ['a property the process declares', undefined, 'Play', '> {max_unanswered} unanswered', '> 0.2 unanswered'],
      ['as a percentage', undefined, 'Play', '> {max_unanswered:%} unanswered', '> 20% unanswered'],
      ['a key of the Parameters wired into a sub-process, and a field of one', undefined, 'Test', 'p < {alpha}, {rules.min_per_arm} per arm', 'p < 0.05, 4 per arm'],
      ['the Parameters wired into a task declare nothing', undefined, 'Play', '{speed}', '{speed}'],
      ['the innermost declaration wins', undefined, 'Test', '{arm}', 'cautious'],
      ['a run\'s state over the value declared', { Subjects: { max_unanswered: 0.25 } }, 'Play', '{max_unanswered:%}', '25%'],
      ['a scope\'s declared value over an outer scope\'s state', { Subjects: { arm: 'impulsive' } }, 'Test', '{arm}', 'cautious'],
      ['only a number takes the percentage', undefined, 'Play', '{arm:%}', '{arm:%}'],
    ];
    for (const [label, state, elementId, text, expected] of CASES) {
      const model = studyModel(declared + (state ? yaml.dump({ state }, YAML_DUMP_OPTIONS) : ''));
      expect(resolvePlaceholdersIn(model, text, elementId), label).toBe(expected);
    }
  });
});
