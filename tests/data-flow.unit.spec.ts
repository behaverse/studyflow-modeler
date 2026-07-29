import { readdirSync } from 'node:fs';
import path from 'node:path';

import { expect, test } from '@playwright/test';
import { BpmnModdle } from 'bpmn-moddle';

import { buildCatalog, setCatalog } from '../src/core/catalog';
import { toModdlePackages } from '../src/core/schema';
import { getInferredDataNeighbors } from '../src/modeler/models/inspector/dataNeighbors';
import { getPropertiesInScope, getStateProperties } from '../src/modeler/models/inspector/stateProperties';
import { loadSchemaModels } from './schemas';
import { exampleXml } from './utils';

/**
 * What a step's data contract says and what the canvas draws are two readings
 * of one file, and a reader who compares them has to find the same answer.
 *
 * Three ways a diagram can break that, all of them found in shipped examples:
 *
 * - a step writes to a data element over a `bpmn:Association` — the artifact
 *   connector BPMN uses to pin a note to a shape. It draws the same dotted
 *   line a data association draws, and it means nothing: the inspector reads
 *   `dataInputAssociations`/`dataOutputAssociations`, so the picture claims a
 *   data flow the step does not have.
 * - a real data association has no `BPMNEdge`, so the inspector lists an input
 *   the canvas shows no wire for and the data element floats unattached.
 * - a data element is drawn and wired to nothing at all, so nothing in the
 *   file says who reads or writes it.
 *
 * A wire *is* allowed to go undrawn when it cannot be drawn: onto a
 * `bpmn:Property`, which BPMN never renders, or out of a collapsed sub-process
 * into an enclosing scope, whose shape lives on another plane. And a diagram
 * that joins nothing at all is a catalogue of shapes rather than a study, so
 * an unwired data element there is a specimen, not an orphan. Each of those
 * three exemptions is read off the file — none is a diagram named in a list
 * here — and anything else is the file contradicting itself.
 */

const EXAMPLES_DIR = path.join(process.cwd(), 'src/assets/examples');
const examples = readdirSync(EXAMPLES_DIR).filter((f) => f.endsWith('.png')).sort();

const models = loadSchemaModels();
const packages: Record<string, any> = Object.fromEntries(
  models.map((model) => [model.prefix, toModdlePackages(model, models)]),
);
setCatalog(buildCatalog(models));

type Model = { definitions: any; planes: Array<Map<string, any>>; edges: Set<string> };

const DRAWN_DATA = ['bpmn:DataObjectReference', 'bpmn:DataStoreReference'];

function isDrawnData(element: any): boolean {
  return DRAWN_DATA.includes(element?.$type);
}

/** The process or sub-process an element is declared in. */
function containerOf(element: any): any {
  let node = element?.$parent;
  while (node && node.$type !== 'bpmn:Process' && node.$type !== 'bpmn:SubProcess') node = node.$parent;
  return node;
}

/** Every activity of a definitions tree, walking into sub-processes. */
function activities(definitions: any): any[] {
  const found: any[] = [];
  const visit = (container: any): void => {
    for (const element of container?.flowElements ?? []) {
      found.push(element);
      if (element.flowElements) visit(element);
    }
  };
  for (const root of definitions.rootElements ?? []) visit(root);
  return found;
}

/** Data associations of a diagram, as `{ association, step, dataElement }`. */
function wiresOf(definitions: any): Array<{ association: any; step: any; dataElement: any }> {
  return activities(definitions).flatMap((step: any) => [
    ...(step.dataInputAssociations ?? []).flatMap((association: any) =>
      (association.sourceRef ?? []).map((dataElement: any) => ({ association, step, dataElement }))),
    ...(step.dataOutputAssociations ?? [])
      .filter((association: any) => association.targetRef)
      .map((association: any) => ({ association, step, dataElement: association.targetRef })),
  ]);
}

/**
 * Whether the diagram joins anything to anything — a sequence flow, a message
 * flow, or a data association.
 *
 * A file that joins nothing is a catalogue of shapes rather than a study, and
 * "who reads or writes this?" is not a question it is answering: the
 * kitchensink places one instance of every palette element in a labelled band,
 * data elements included, and wiring them would assert a flow it does not mean
 * — its tasks and events are unconnected for the same reason. Read off the
 * file rather than named in a list here, so a second catalogue needs no edit
 * and a study that forgets a wire still fails.
 */
function connectsAnything(definitions: any): boolean {
  if (wiresOf(definitions).length > 0) return true;
  if (activities(definitions).some((el: any) => el.$type === 'bpmn:SequenceFlow')) return true;
  return (definitions.rootElements ?? []).some((root: any) => (root.messageFlows ?? []).length > 0);
}

async function read(filename: string): Promise<Model> {
  const moddle = new BpmnModdle(structuredClone(packages)) as any;
  const { rootElement: definitions } = await moddle.fromXML(exampleXml(filename));

  const planes: Array<Map<string, any>> = [];
  const edges = new Set<string>();
  for (const diagram of definitions.diagrams ?? []) {
    const shapes = new Map<string, any>();
    for (const di of diagram.plane?.get('planeElement') ?? []) {
      if (!di.bpmnElement?.id) continue;
      if (di.$type === 'bpmndi:BPMNShape') shapes.set(di.bpmnElement.id, di);
      if (di.$type === 'bpmndi:BPMNEdge') edges.add(di.bpmnElement.id);
    }
    planes.push(shapes);
  }
  return { definitions, planes, edges };
}

test.describe('shipped examples: the figure and the data contract agree', () => {
  for (const filename of examples) {
    test(`${filename} draws every wire it can draw`, async () => {
      const { definitions, planes, edges } = await read(filename);

      const undrawn = wiresOf(definitions)
        // A property has no shape anywhere, by BPMN's own rule.
        .filter(({ dataElement }) => isDrawnData(dataElement))
        // Both ends on one plane is exactly when an edge can exist; a wire out
        // of a sub-process into an enclosing scope spans two and cannot.
        .filter(({ step, dataElement }) =>
          planes.some((shapes) => shapes.has(step.id) && shapes.has(dataElement.id)))
        .filter(({ association }) => !edges.has(association.id))
        .map(({ association, step, dataElement }) => `${association.id}: ${step.id} ~ ${dataElement.id}`);

      expect(undrawn, 'data associations between two shapes on one plane, with no BPMNEdge').toEqual([]);
    });

    test(`${filename} routes its data flow through data associations`, async () => {
      const { definitions } = await read(filename);

      // A `bpmn:Association` reaching a data element draws a line the
      // inspector cannot see: whatever it meant to say belongs in a data
      // input/output association. Between two artifacts it is what BPMN
      // provides — a dictionary describing a dataset is not a step's contract.
      const artifacts: any[] = (definitions.rootElements ?? []).flatMap((root: any) => root.artifacts ?? []);
      const miswired = artifacts
        .filter((a: any) => a.$type === 'bpmn:Association')
        .filter((a: any) => isDrawnData(a.sourceRef) !== isDrawnData(a.targetRef))
        .map((a: any) => `${a.id}: ${a.sourceRef?.id} -> ${a.targetRef?.id}`);

      expect(miswired, 'artifact associations standing in for data flow').toEqual([]);
    });

    test(`${filename} says who reads or writes each data element it draws`, async () => {
      const { definitions, planes } = await read(filename);

      // A catalogue joins nothing at all, so its data shapes are specimens
      // (see `connectsAnything`). What it must not do is wire *some* of them:
      // half a data flow is the state a reader cannot tell from a mistake.
      if (!connectsAnything(definitions)) {
        expect(wiresOf(definitions), `${filename} joins nothing, yet wires data`).toEqual([]);
        return;
      }

      const wired = new Set(wiresOf(definitions).map(({ dataElement }) => dataElement?.id));
      const linked = new Set((definitions.rootElements ?? [])
        .flatMap((root: any) => root.artifacts ?? [])
        .filter((a: any) => a.$type === 'bpmn:Association')
        .flatMap((a: any) => [a.sourceRef?.id, a.targetRef?.id]));

      const orphans = activities(definitions)
        .filter(isDrawnData)
        .filter((element: any) => planes.some((shapes) => shapes.has(element.id)))
        .filter((element: any) => !wired.has(element.id) && !linked.has(element.id))
        .map((element: any) => `${element.id} (${element.name ?? ''})`);

      expect(orphans, 'data elements drawn on the canvas that nothing wires').toEqual([]);
    });
  }

  test('a wire out of a sub-process is reported with the scope it reaches into', async () => {
    // agent_eval declares its artifacts on the process because they outlive
    // each round of the optimization loop, and reads them from steps nested
    // one and two levels down. Legal BPMN (§10.4.7), and undrawable: the
    // inspector has to name the scope, since there is no line to follow.
    const { definitions, planes } = await read('agent_eval.png');

    const crossing = wiresOf(definitions)
      .filter(({ step, dataElement }) =>
        isDrawnData(dataElement) && containerOf(dataElement) !== containerOf(step));

    expect(crossing.length).toBeGreaterThan(0);
    for (const { step, dataElement } of crossing) {
      // The premise of the scope tag: the two ends really are on two planes.
      expect(planes.some((shapes) => shapes.has(step.id) && shapes.has(dataElement.id))).toBe(false);
      expect(containerOf(dataElement).name || containerOf(dataElement).id).toBeTruthy();
    }
  });
});

/** The element with `id` anywhere in a parsed diagram. */
function elementById(definitions: any, id: string): any {
  return [...activities(definitions), ...(definitions.rootElements ?? [])].find((e: any) => e.id === id);
}

test.describe('what the inspector reports for a step', () => {
  test('names the scope a wire reaches into, and stays quiet about a sibling', async () => {
    const { definitions } = await read('agent_eval.png');

    // The judge reads a rubric declared two levels out — the row has to say so,
    // because there is no line to find on the canvas. Asserted as a whole row
    // so an example that loses the wire reports that, rather than throwing on
    // a field of the input it no longer has.
    expect(getInferredDataNeighbors(elementById(definitions, 'Score'), 'inputs')).toEqual([
      expect.objectContaining({
        name: 'Scoring rubric',
        kind: 'data object',
        outerScope: 'Agent evaluation harness',
        binding: 'rubric',
      }),
    ]);

    // A wire between siblings is drawn, so naming the scope would be noise.
    const { definitions: sklearn } = await read('sklearn_pipeline.png');
    expect(getInferredDataNeighbors(elementById(sklearn, 'Select_Features'), 'inputs')).toEqual([
      expect.objectContaining({
        name: 'Input dataset (features + target)',
        outerScope: undefined,
      }),
    ]);
  });

  test('hides the property bpmn-js invents to hold a wire\'s target', async () => {
    // Drawing a data object onto a step makes bpmn-js park the association's
    // required `targetRef` on a `bpmn:Property` named `__targetRef_placeholder`
    // — an artifact of the file format that no author declared. lablink_demo2
    // ships one, as every diagram drawn in the modeler would.
    const { definitions } = await read('lablink_demo2.png');
    const step = elementById(definitions, 'ReadBIDS');
    expect(step.properties.map((p: any) => p.name)).toContain('__targetRef_placeholder');

    // Neither the State tab nor the bind list offers it as a variable.
    expect(getStateProperties(step)).toEqual([]);
    expect(getPropertiesInScope(step).map((p) => p.name)).not.toContain('__targetRef_placeholder');

    // The wire it exists for is still reported, by the element it comes from.
    expect(getInferredDataNeighbors(step, 'inputs').map((n) => n.name)).toEqual(['Raw BIDS data']);
  });
});
