import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import * as yaml from 'js-yaml';

import {
  importJsPsychTimeline,
  jsPsychToStudyflow,
  parseTimeline,
  type JsPsychNode,
} from '../src/modeler/models/import';
import { parseFunctionRef } from '../src/core/functionRef';
import { SCHEMAS } from '../src/core/constants';
import { parseStudyflow } from '../src/runner/models/parseStudyflow';
import { fromModdleYaml, toModdlePackages } from '../src/core/schema';
import { looksLikeXml } from '../src/core/codec';

/**
 * jsPsych -> Studyflow importer.
 *
 * The mapping (`importJsPsychTimeline`) is exercised on a sample Flanker
 * timeline; the serialization (`jsPsychToStudyflow`) is round-tripped through
 * `parseStudyflow` so the emitted `.studyflow` is a real, openable flow graph.
 */

const SCHEMA_DIR = path.join(process.cwd(), 'src/assets/schemas');
const FIXTURES_DIR = path.join(process.cwd(), 'tests/fixtures');

const models = SCHEMAS.map(({ prefix }) =>
  fromModdleYaml(readFileSync(path.join(SCHEMA_DIR, `${prefix}.moddle.yaml`), 'utf8')),
);
// BpmnModdle mutates its packages in place, so hand every consumer its own clone.
const buildPackages = (): Record<string, any> =>
  Object.fromEntries(models.map((model) => [model.prefix, toModdlePackages(model, models)]));

const flankerTimeline = (): JsPsychNode[] =>
  JSON.parse(readFileSync(path.join(FIXTURES_DIR, 'flanker.timeline.json'), 'utf8'));

test.describe('importJsPsychTimeline (mapping)', () => {
  test('folds a leading consent node into the start event', () => {
    const study = importJsPsychTimeline(flankerTimeline(), { id: 'flanker', name: 'Flanker demo' });

    // The consent node is consumed, not emitted as a task.
    expect(study.consentFormUri).toBe('https://example.org/protocols/flanker/consent.md');
    expect(study.tasks).toHaveLength(4);
    expect(study.tasks.map((t) => t.name)).toEqual(['Instructions', 'Fixation', 'Flanker test', 'Debrief']);
    expect(study.warnings).toEqual([]);
  });

  test('maps each node to a jspsych cognitive task with a versioned function reference', () => {
    const study = importJsPsychTimeline(flankerTimeline(), { jsPsychVersion: '8.0.0' });

    for (const task of study.tasks) {
      expect(task.instrument).toBe('jspsych');
      const parsed = parseFunctionRef(task.functionRef);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect(parsed.value.scheme).toBe('jspsych');
        expect(parsed.value.version).toBe('8.0.0');
      }
    }
  });

  test('normalizes the plugin id (class name and kebab id resolve alike)', () => {
    const study = importJsPsychTimeline(flankerTimeline(), { jsPsychVersion: '8' });
    const instructions = study.tasks.find((t) => t.name === 'Instructions')!; // jsPsychHtmlKeyboardResponse
    const flanker = study.tasks.find((t) => t.name === 'Flanker test')!; // html-keyboard-response

    expect(instructions.functionRef).toBe('jspsych://html-keyboard-response@8');
    expect(flanker.functionRef).toBe('jspsych://html-keyboard-response@8');
  });

  test('carries the node parameters as configurations and drops `type`', () => {
    const study = importJsPsychTimeline(flankerTimeline());
    const flanker = study.tasks.find((t) => t.name === 'Flanker test')!;

    expect(flanker.configurations).not.toHaveProperty('type');
    expect(flanker.configurations.n_trials).toBe(96);
    expect(flanker.configurations.InterStimulusInterval).toBe(0.5);
    expect(Array.isArray(flanker.configurations.timeline_variables)).toBe(true);
    expect((flanker.configurations.timeline_variables as unknown[])).toHaveLength(4);
  });

  test('assigns unique, sanitized BPMN ids', () => {
    const study = importJsPsychTimeline([
      { type: 'html-keyboard-response', name: 'Trial A' },
      { type: 'html-keyboard-response', name: 'Trial A' },
    ]);
    expect(study.tasks.map((t) => t.id)).toEqual(['Trial_A', 'Trial_A_2']);
  });

  test('maps a nested procedure (no top-level type) to one task with a warning', () => {
    // A jsPsych procedure groups trials under `timeline`/`timeline_variables`
    // with no plugin `type` of its own; it becomes a single cognitive task.
    const study = importJsPsychTimeline([
      {
        name: 'Flanker block',
        timeline: [{ type: 'html-keyboard-response', stimulus: 'jsPsych.timelineVariable("stimulus")' }],
        timeline_variables: [{ stimulus: 'a' }, { stimulus: 'b' }],
        repetitions: 4,
      },
    ]);
    expect(study.tasks).toHaveLength(1);
    expect(study.tasks[0].functionRef).toBe('jspsych://timeline@8');
    expect(study.tasks[0].configurations).toHaveProperty('timeline');
    expect(study.warnings.some((w) => w.includes('no resolvable plugin'))).toBe(true);
  });

  test('accepts an experiment object and a JSON string, not just an array', () => {
    const arr = flankerTimeline();
    expect(parseTimeline({ timeline: arr })).toHaveLength(arr.length);
    expect(parseTimeline(JSON.stringify(arr))).toHaveLength(arr.length);
    expect(() => parseTimeline('{ not json')).toThrow(/not valid JSON/);
    expect(() => parseTimeline({} as never)).toThrow(/timeline array/);
  });

  test('rejects JSON that parses but is not a timeline', () => {
    // Arbitrary .json files reach the importer via the UI; they must fail
    // loudly, not import as a study of "unknown" tasks.
    expect(() => parseTimeline('[1, 2, 3]')).toThrow(/does not look like a jsPsych timeline/);
    expect(() => parseTimeline('[]')).toThrow(/does not look like a jsPsych timeline/);
    expect(() => parseTimeline('[[{"type": "x"}]]')).toThrow(/does not look like a jsPsych timeline/);
    expect(() => parseTimeline('{"timeline": ["a"]}')).toThrow(/does not look like a jsPsych timeline/);
    expect(() => parseTimeline('{"name": "package.json", "version": "1.0.0"}')).toThrow(/timeline array/);
  });
});

test.describe('importJsPsychTimeline (options)', () => {
  test('per-plugin version override wins over the default', () => {
    const study = importJsPsychTimeline(flankerTimeline(), {
      jsPsychVersion: '8',
      pluginVersions: { 'html-keyboard-response': '2.1.0' },
    });
    const instructions = study.tasks.find((t) => t.name === 'Instructions')!;
    expect(instructions.functionRef).toBe('jspsych://html-keyboard-response@2.1.0');
  });

  test('a custom functionRef resolver can reproduce a curated reference', () => {
    const study = importJsPsychTimeline(flankerTimeline(), {
      functionRef: ({ node }) =>
        (node.data as { task?: string } | undefined)?.task === 'flanker'
          ? 'https://github.com/jspsych/jspsych-contrib@v0.4.0#flanker'
          : undefined,
    });
    const flanker = study.tasks.find((t) => t.name === 'Flanker test')!;
    expect(flanker.functionRef).toBe('https://github.com/jspsych/jspsych-contrib@v0.4.0#flanker');
    // Other nodes still fall back to the default jspsych scheme.
    expect(study.tasks.find((t) => t.name === 'Instructions')!.functionRef).toMatch(/^jspsych:\/\//);
  });

  test('detectConsent:false keeps the consent node as a task', () => {
    const study = importJsPsychTimeline(flankerTimeline(), { detectConsent: false });
    expect(study.consentFormUri).toBeUndefined();
    expect(study.tasks).toHaveLength(5);
    expect(study.tasks[0].name).toBe('Consent');
  });

  test('an explicit consentFormUri is emitted even without a consent node', () => {
    const study = importJsPsychTimeline([{ type: 'html-keyboard-response', name: 'Trial' }], {
      consentFormUri: 'consent.pdf',
    });
    expect(study.consentFormUri).toBe('consent.pdf');
    expect(study.tasks).toHaveLength(1);
  });

  test('drops function-valued parameters and records a warning (JS-module path)', () => {
    const study = importJsPsychTimeline([
      { type: 'html-keyboard-response', name: 'Trial', stimulus: '+', on_finish: () => undefined },
    ]);
    expect(study.tasks[0].configurations).not.toHaveProperty('on_finish');
    expect(study.tasks[0].configurations.stimulus).toBe('+');
    expect(study.warnings.some((w) => w.includes('on_finish'))).toBe(true);
  });
});

test.describe('jsPsychToStudyflow (serialization)', () => {
  test('emits a .studyflow (YAML) whose flow graph chains start -> tasks -> end', async () => {
    const { studyflow, study } = await jsPsychToStudyflow(flankerTimeline(), buildPackages(), {
      id: 'flanker',
      name: 'Flanker demo',
      jsPsychVersion: '8.0.0',
    });

    // The output is YAML, not XML, and loads through the shared parser.
    expect(looksLikeXml(studyflow)).toBe(false);
    const parsed = await parseStudyflow(studyflow, buildPackages());

    // Start, 4 tasks, End.
    expect(parsed.startId).toBe('Start');
    expect(parsed.flowNodes.size).toBe(study.tasks.length + 2);
    expect(parsed.sequenceFlows.size).toBe(study.tasks.length + 1);

    // The chain is linear: every non-terminal node has exactly one out-edge.
    const start = parsed.flowNodes.get('Start')!;
    expect(start.incoming).toHaveLength(0);
    expect(start.outgoing).toHaveLength(1);
    const end = parsed.flowNodes.get('End')!;
    expect(end.outgoing).toHaveLength(0);
    expect(end.incoming).toHaveLength(1);
  });

  test('each task node is a cognitive task with instrument, implementation, and configurations', async () => {
    const { studyflow } = await jsPsychToStudyflow(flankerTimeline(), buildPackages(), { jsPsychVersion: '8' });
    const parsed = await parseStudyflow(studyflow, buildPackages());

    const flanker = [...parsed.flowNodes.values()].find((n) => n.businessObject.name === 'Flanker test')!;
    expect(flanker.extensionType).toBe('cognitive:CognitiveTask');
    // The versioned reference is BPMN's own UserTask#implementation attribute.
    expect(flanker.businessObject.get('implementation')).toBe('jspsych://html-keyboard-response@8');

    const wrapper = flanker.businessObject.extensionElements.values[0];
    expect(wrapper.get('instrument')).toBe('jspsych');
    const config = yaml.load(wrapper.get('configurations').get('value')) as Record<string, unknown>;
    expect(config.n_trials).toBe(96);
    expect(config).not.toHaveProperty('type');
  });

  test('the start event carries the consent link', async () => {
    const { studyflow } = await jsPsychToStudyflow(flankerTimeline(), buildPackages());
    const parsed = await parseStudyflow(studyflow, buildPackages());
    const start = parsed.flowNodes.get('Start')!;
    expect(start.businessObject.get('studyflow:consentFormUri')).toBe(
      'https://example.org/protocols/flanker/consent.md',
    );
  });

  test('XML-unsafe config content (arrows, HTML, ampersands) survives a load', async () => {
    // jsPsych stimuli routinely carry `<`, `>`, `&`; the config body must
    // round-trip through the XML codec underneath the YAML.
    const { studyflow } = await jsPsychToStudyflow(
      [{ type: 'html-keyboard-response', name: 'Trial', stimulus: '<p>&lt; L &amp; R <<<<< </p>', choices: ['f', 'j'] }],
      buildPackages(),
    );
    const parsed = await parseStudyflow(studyflow, buildPackages());
    const trial = parsed.flowNodes.get('Trial')!;
    const config = yaml.load(trial.businessObject.extensionElements.values[0].get('configurations').get('value')) as Record<
      string,
      unknown
    >;
    expect(config.stimulus).toBe('<p>&lt; L &amp; R <<<<< </p>');
  });

  test('auto-layout attaches diagram geometry to every node and flow', async () => {
    const { studyflow, study } = await jsPsychToStudyflow(flankerTimeline(), buildPackages());
    // In the YAML format, geometry folds inline: `bounds` on each node,
    // `waypoint` on each flow.
    const bounds = studyflow.match(/^\s*bounds:/gm) ?? [];
    const waypoints = studyflow.match(/^\s*waypoint:/gm) ?? [];
    expect(bounds).toHaveLength(study.tasks.length + 2);
    expect(waypoints).toHaveLength(study.tasks.length + 1);
  });
});
