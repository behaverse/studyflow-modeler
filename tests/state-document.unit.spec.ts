import { expect, test } from '@playwright/test';
import { BpmnModdle } from 'bpmn-moddle';
import * as yaml from 'js-yaml';

import { toModdlePackages } from '@core/notation/schemaFile';
import { buildCatalog, setCatalog } from '@core/notation';
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
} from '@core/document';
import { loadSchemaModels } from './schemas';

/** `state:` is the retrospective tree (docs/design/state.md): JSON on the Study extension, a mapping in the file. */

const models = loadSchemaModels();
setCatalog(buildCatalog(models));
const packages: Record<string, any> = Object.fromEntries(
  models.map((model) => [model.prefix, toModdlePackages(model, models)]),
);
const newModdle = () => new BpmnModdle(structuredClone(packages)) as any;

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
    const xml = await studyflowToXml(DOC, newModdle());
    expect(xml).toMatch(/<studyflow:study>\s*<studyflow:state>\{.*\}<\/studyflow:state>/s);
    expect(xml).toContain('studyflow:value="0"');

    const moddle = newModdle();
    const { rootElement } = await moddle.fromXML(xml);
    expect(JSON.parse(studyExtensionOf(rootElement)!.state)).toEqual(STATE);
    expect(readState(rootElement)).toEqual(STATE);

    const back = await xmlToStudyflow(xml, newModdle());
    expect(back.endsWith(STATE_BLOCK)).toBe(true);
  });

  test('an empty tree leaves no state: key and no property', async () => {
    const definitions = studyflowToDefinitions(BODY, newModdle());
    expect(readState(definitions)).toEqual({});
    expect(await xmlToStudyflow(await studyflowToXml(BODY, newModdle()), newModdle())).not.toContain('state:');

    const moddle = newModdle();
    const fresh = studyflowToDefinitions(BODY, moddle);
    writeState(fresh, moddle, { Excluded_Pre: { count: 1 } });
    expect(readState(fresh)).toEqual({ Excluded_Pre: { count: 1 } });
    writeState(fresh, moddle, {});
    expect(studyExtensionOf(fresh)!.state).toBeUndefined();
  });

  test('resolveState walks the element, its containers, then the study root', () => {
    const definitions = studyflowToDefinitions(DOC, newModdle());
    expect(resolveState(definitions, 'Excluded_Pre', 'count')).toBe(3);
    expect(resolveState(definitions, 'Trial', 'failed_trials')).toBe(2);
    expect(resolveState(definitions, 'Trial', 'arm')).toBe('A');
    expect(resolveState(definitions, 'Example_Study', 'arm')).toBe('A');
    expect(resolveState(definitions, 'Trial', 'count')).toBeUndefined();
    expect(resolveState(definitions, 'Trial', 'state.Excluded_Pre.count')).toBe(3);
    expect(resolveState(definitions, 'Trial', 'state.Example_Study.arm')).toBe('A');
    expect(resolveState(definitions, 'Nope', 'count')).toBeUndefined();
  });

  test('a single-segment path falls back to the runner counter under _meta, and _meta is readable absolutely', () => {
    const definitions = studyflowToDefinitions(DOC, newModdle());
    expect(resolveState(definitions, 'Excluded_Pre', 'reached')).toBe(4);
    expect(resolveState(definitions, 'Excluded_Pre', 'count')).toBe(3);
    expect(resolveState(definitions, 'Trial', 'reached')).toBe(1); // Battery's counter, lexically
    expect(resolveState(definitions, 'Example_Study', 'reached')).toBeUndefined();
    expect(resolveState(definitions, 'Trial', 'state._meta.reached.Excluded_Pre')).toBe(4);
    expect(resolveState(definitions, 'Trial', 'state._meta.prov.0.who')).toBe('alice');
    expect(resolveState(definitions, 'Excluded_Pre', 'reached.Battery')).toBeUndefined();
  });

  test('resolvePlaceholders substitutes what resolves and leaves the rest as written', () => {
    const definitions = studyflowToDefinitions(DOC, newModdle());
    expect(resolvePlaceholders('Excluded (n={count})', definitions, 'Excluded_Pre')).toBe('Excluded (n=3)');
    expect(resolvePlaceholders('{arm}/{missing} {reached} {state.Battery.failed_trials}', definitions, 'Excluded_Pre'))
      .toBe('A/{missing} 4 2');
    expect(resolvePlaceholders('Excluded (n={count})', studyflowToDefinitions(BODY, newModdle()), 'Excluded_Pre'))
      .toBe('Excluded (n={count})');
  });
});
