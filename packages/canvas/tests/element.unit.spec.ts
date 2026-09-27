import { expect, test } from '@playwright/test';

import './pageGlobals';
import { studyflowToDefinitions } from '@core/document';
import { defineStudyflowCanvas, type StudyflowCanvasElement } from '@canvas/element.ts';
import { Study } from '@canvas/index.ts';

import { freshModdle, installDocument } from './canvasHarness';

/** `<studyflow-canvas>` in jsdom: the element a page embeds, built on the canvas's index alone. */

const study = (name: string): string => `id: Defs_1
definitions:
  targetNamespace: http://bpmn.io/schema/bpmn
Process_1:
  type: Process
  flowElements:
    ${name}:
      type: Task
      name: ${name}
      bounds: 200 80 100 80
`;

test('<studyflow-canvas> shows the study it is handed, looks only when readonly, reads the file src names, and lets go when removed', async () => {
  const doc = installDocument();
  defineStudyflowCanvas();
  defineStudyflowCanvas();
  const element = doc.createElement('studyflow-canvas') as unknown as StudyflowCanvasElement;
  element.setAttribute('readonly', '');
  doc.body.appendChild(element as unknown as Node);

  element.study = Study.fromDefinitions(studyflowToDefinitions(study('Handed'), freshModdle()));
  expect(element.querySelector('[data-element-id="Handed"]')).not.toBeNull();
  expect(element.canvas?.editable).toBe(false);
  element.removeAttribute('readonly');
  expect(element.canvas?.editable).toBe(true);

  const fetched = globalThis.fetch;
  globalThis.fetch = (async () => ({ ok: true, text: async () => study('Read') })) as unknown as typeof fetch;
  try {
    element.moddle = freshModdle();
    element.setAttribute('src', 'read.studyflow.yaml');
    await expect.poll(() => element.querySelector('[data-element-id="Read"]')).not.toBeNull();
    expect(element.querySelector('[data-element-id="Handed"]'), 'one view at a time').toBeNull();
  } finally {
    globalThis.fetch = fetched;
  }

  element.remove();
  expect(element.canvas).toBeUndefined();
  expect(element.childElementCount, 'the view went with it').toBe(0);
});
