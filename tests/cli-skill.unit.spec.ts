import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from '@playwright/test';

/** `studyflow skill add`: a skill from outside the repository joins the CLI, its schema read as a shipped one's is. */
test('an installed skill\'s vocabulary is read by validate, and removing it takes it away', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'studyflow-skill-'));
  execFileSync(process.execPath, [path.join(process.cwd(), 'node_modules/vite/bin/vite.js'), 'build', 'packages/cli', '--outDir', path.join(dir, 'bin'), '--logLevel', 'error']);
  const env = { ...process.env, STUDYFLOW_HOME: path.join(dir, 'home') };
  const studyflow = (...args: string[]) => spawnSync(process.execPath, [path.join(dir, 'bin', 'studyflow.mjs'), ...args], { encoding: 'utf8', env });

  const skill = path.join(dir, 'lab');
  mkdirSync(skill);
  writeFileSync(path.join(skill, 'SKILL.md'), `---
name: lab
description: "A lab's probe step. Use when a study probes."
metadata:
  schema: "lab.moddle.yaml"
  schemes: "lab"
---
The lab's vocabulary.
`);
  writeFileSync(path.join(skill, 'lab.moddle.yaml'), `name: Lab
prefix: lab
uri: http://example.org/schemas/lab
xml:
  tagAlias: lowerCase
version: '26.9.1'
types:
  - name: Probe
    description: A probe step.
    superClass:
      - bpmn:Task
    properties:
      - name: depth
        description: How deep it probes.
        type: Integer
        isAttr: true
`);
  const study = path.join(dir, 'probe.studyflow.yaml');
  writeFileSync(study, `id: probe
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Study:
  type: Process
  flowElements:
    Start:
      type: StartEvent
    Probe:
      type: Task
      extensionElements:
        - type: lab:Probe
          depth: 3
    End:
      type: EndEvent
    F1: Start -> Probe
    F2: Probe -> End
`);

  expect(studyflow('skill', 'add', skill).status).toBe(0);
  expect(studyflow('skill', 'list').stdout).toMatch(/^lab {2}lab:/m);
  const known = studyflow('validate', study);
  expect(known.status).toBe(0);
  expect(known.stderr, 'the schema is the installed skill\'s').toBe('');

  expect(studyflow('skill', 'remove', 'lab').status).toBe(0);
  const unknown = studyflow('validate', study);
  expect(unknown.stderr).toMatch(/unknown type <lab:Probe>/);
  expect(unknown.status).toBe(1);
});
