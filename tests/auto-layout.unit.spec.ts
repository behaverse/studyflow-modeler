import { readFileSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import { BpmnModdle } from 'bpmn-moddle';

import { studyflowToXml } from '../src/core/codec';
import { SCHEMAS } from '../src/core/constants';
import { fromModdleYaml, toModdlePackages } from '../src/core/schema';
import { ensureDiagramLayout, hasDiagramInterchange } from '../src/modeler/models/autoLayout';

/**
 * Hand-written `.studyflow` files describe only the flow graph and carry no
 * BPMN DI; bpmn-js aborts such an import with "no diagram to display".
 * `ensureDiagramLayout` closes that gap at the import boundary by synthesizing
 * a layout when — and only when — geometry is missing, without disturbing the
 * semantic tree or any extension.
 */

const SCHEMA_DIR = path.join(process.cwd(), 'src/assets/schemas');
const models = SCHEMAS.map(({ prefix }) =>
  fromModdleYaml(readFileSync(path.join(SCHEMA_DIR, `${prefix}.moddle.yaml`), 'utf8')),
);
const packages: Record<string, any> = Object.fromEntries(
  models.map((model) => [model.prefix, toModdlePackages(model, models)]),
);

const layoutlessXml = () => {
  const text = readFileSync(path.join(process.cwd(), 'tests/fixtures/layoutless.studyflow'), 'utf8');
  return studyflowToXml(text, new BpmnModdle(structuredClone(packages)) as any);
};

test.describe('ensureDiagramLayout', () => {
  test('detects presence and absence of diagram interchange', () => {
    expect(hasDiagramInterchange('<bpmndi:BPMNDiagram id="d"><bpmndi:BPMNPlane/></bpmndi:BPMNDiagram>')).toBe(true);
    expect(hasDiagramInterchange('<bpmn2:definitions><bpmn2:process/></bpmn2:definitions>')).toBe(false);
  });

  test('synthesizes DI for a layout-less diagram, preserving every extension', async () => {
    const xml = await layoutlessXml();
    // Precondition: the converted file has no geometry — this is the failing case.
    expect(hasDiagramInterchange(xml)).toBe(false);

    const laidOut = await ensureDiagramLayout(xml);

    // A full DI tree is now present: a diagram, a plane, and a shape per node.
    expect(hasDiagramInterchange(laidOut)).toBe(true);
    expect(laidOut).toContain('BPMNPlane');
    expect(laidOut).toMatch(/BPMNShape[^>]*bpmnElement="Enroll"/);
    expect(laidOut).toMatch(/BPMNShape[^>]*bpmnElement="DidNotStart"/); // boundary event laid out too
    expect(laidOut).toMatch(/BPMNEdge[^>]*bpmnElement="Flow_Eligible"/);

    // Auto-layout only *adds* geometry; the semantic tree and its studyflow /
    // cognitive extensions survive untouched.
    expect(laidOut).toContain('studyflow:study');
    expect(laidOut).toContain('cognitive:questionnaire');
    expect(laidOut).toContain('instrument="screening"');
    expect(laidOut).toContain('attachedToRef="Allocate"');
  });

  test('returns a diagram that already carries geometry unchanged', async () => {
    const authored = await studyflowToXml(
      readFileSync(path.join(process.cwd(), 'src/assets/examples/consort2025.studyflow'), 'utf8'),
      new BpmnModdle(structuredClone(packages)) as any,
    );
    expect(hasDiagramInterchange(authored)).toBe(true);
    // No round-trip through auto-layout: the authored bytes are returned as-is.
    expect(await ensureDiagramLayout(authored)).toBe(authored);
  });
});
