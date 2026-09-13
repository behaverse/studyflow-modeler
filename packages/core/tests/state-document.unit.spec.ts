import { expect, test } from '@playwright/test';
import * as yaml from 'js-yaml';

import {
  YAML_DUMP_OPTIONS,
  readState,
  resolvePlaceholders,
  resolveState,
  studyExtensionOf,
  studyflowToDefinitions,
  studyflowToXml,
  writeState,
  xmlToStudyflow,
  type StateTree,
} from '@core/document';
import { freshModdle } from '@tests/schemas';

/** `state:` is the retrospective tree (docs/reference.qmd, "Run state"): JSON on the Study extension, a mapping in the file. */

const STATE = {
  _meta: {
    prov: [{ action: 'executed', when: '2026-09-04T10:00:00Z', who: 'alice' }],
    reached: { Battery: 1, Excluded_Pre: 4 },
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
          value: "0"
      flowElements:
        Trial:
          type: bpmn:Task
    Excluded_Pre:
      type: bpmn:EndEvent
      name: Excluded (n={count})
      properties:
        P_Count:
          name: count
          value: "0"
    F1:
      type: bpmn:SequenceFlow
      sourceRef: Battery
      targetRef: Excluded_Pre
`;

const DOC = BODY + STATE_BLOCK;

test.describe('state in the document', () => {
  test('YAML -> XML -> YAML keeps state: byte-identical, and the XML holds it as JSON', async () => {
    const xml = await studyflowToXml(DOC, freshModdle());
    expect(xml).toMatch(/<studyflow:study>\s*<studyflow:state>\{.*\}<\/studyflow:state>/s);
    expect(xml).toContain('studyflow:value="0"');

    const moddle = freshModdle();
    const { rootElement } = await moddle.fromXML(xml);
    expect(JSON.parse(studyExtensionOf(rootElement)!.state)).toEqual(STATE);
    expect(readState(rootElement)).toEqual(STATE);

    const back = await xmlToStudyflow(xml, freshModdle());
    expect(back.endsWith(STATE_BLOCK)).toBe(true);
  });

  test('resolveState reads the element, its containers out to the study root, then its runner counter', () => {
    const definitions = studyflowToDefinitions(DOC, freshModdle());
    const CASES: [elementId: string, path: string, expected: unknown][] = [
      ['Excluded_Pre', 'count', 3],
      ['Trial', 'failed_trials', 2], // Battery's, its container
      ['Trial', 'arm', 'A'], // the study root's
      ['Example_Study', 'arm', 'A'],
      ['Trial', 'count', undefined], // a sibling's is out of scope
      ['Nope', 'count', undefined],
      // A single segment falls back to `_meta.<path>.<scope>`, scope by scope.
      ['Excluded_Pre', 'reached', 4],
      ['Trial', 'reached', 1], // Battery's counter, lexically
      ['Example_Study', 'reached', undefined],
      ['Excluded_Pre', 'reached.Battery', undefined],
      // `state.` reads the tree from its top, `_meta` included.
      ['Trial', 'state.Excluded_Pre.count', 3],
      ['Trial', 'state.Example_Study.arm', 'A'],
      ['Trial', 'state._meta.reached.Excluded_Pre', 4],
      ['Trial', 'state._meta.prov.0.who', 'alice'],
    ];
    for (const [elementId, path, expected] of CASES) {
      expect(resolveState(definitions, elementId, path), `${elementId}: ${path}`).toBe(expected);
    }
  });

  test('resolvePlaceholders substitutes what resolves and leaves the rest as written', () => {
    const CASES: [label: string, state: StateTree | undefined, text: string, expected: string][] = [
      ['a name in scope', STATE, 'Excluded (n={count})', 'Excluded (n=3)'],
      ['an unresolved name stays', STATE, '{arm}/{missing} {reached} {state.Battery.failed_trials}', 'A/{missing} 4 2'],
      ['nothing resolves without state', undefined, 'Excluded (n={count})', 'Excluded (n={count})'],
      ['only the braces of a name: YAML and JSON in a value stay put', STATE, '{a: 1} {"arm": 2} {arm}', '{a: 1} {"arm": 2} A'],
      // As in the Python runners.
      ['a name of letters of any script, and hyphens', { Example_Study: { durée: 3 }, _meta: { reached: { 'sid-12': 4 } } }, '{durée} {state._meta.reached.sid-12}', '3 4'],
    ];
    const moddle = freshModdle();
    for (const [label, state, text, expected] of CASES) {
      const definitions = studyflowToDefinitions(BODY, moddle);
      writeState(definitions, moddle, state);
      expect(resolvePlaceholders(text, definitions, 'Excluded_Pre'), label).toBe(expected);
    }
  });
});
