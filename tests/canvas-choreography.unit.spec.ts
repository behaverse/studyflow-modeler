import { expect, test } from '@playwright/test';

import { readChoreographyBands as coreReadBands } from '@core/document/choreography';
import { Canvas } from '@canvas/index.ts';
import {
  DEFAULT_BOTTOM,
  DEFAULT_TOP,
  readChoreographyBands,
} from '@canvas/model/choreography.ts';
import { choreographyBandHeight } from '@canvas/render/shapes.ts';
import type { SceneNode } from '@canvas/model/scene.ts';
import type { ElementChangedEvent } from '@canvas/model/writeback.ts';

import { exampleXml } from './utils';

import { freshModdle, installDocument, loadCanvas, type Loaded } from './canvasHarness';

/**
 * P5 choreography band writeback (design §1, §2 "ChoreographyTask — two participant
 * bands + middle name band", §6 P5).
 *
 * A choreography task draws three bands, and only the middle one is its own: the
 * outer two render `participantRef[0].name` / `participantRef[1].name`, and
 * `initiatingParticipantRef` decides which of them is shaded as initiating. So this
 * spec asserts the **inverse of `@core/document/choreography.readChoreographyBands`**
 * — write a band and the participant's `name` moves in `toXML`, write the initiator
 * and `initiatingParticipantRef` moves, and reading the result back through core's
 * own function gives what was written.
 *
 * Every structural assertion is made against `bpmn-moddle`'s `toXML` of the SAME
 * live tree the canvas edited (and a reload of it), never against the scene alone.
 *
 * Band **geometry** is derived, never stored: the DI carries one `dc:Bounds` for the
 * whole task and `choreographyBandHeight` splits it three ways, so a band edit must
 * leave the serialized `dc:Bounds` byte-identical — asserted throughout.
 */

installDocument();

const EXAMPLE = 'choreography_demo.studyflow.png';

/**
 * A **process-rooted** choreography task with no participants at all — the shape the
 * app hands the canvas after `choreographyToProcessRoot`, and the only path that has
 * to mint both the participant pair AND the `bpmn:Collaboration` that holds it.
 */
const BARE_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
    xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
    xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
    xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
    id="Defs_B" targetNamespace="http://bpmn.io/schema/bpmn">
  <bpmn:process id="Process_B" isExecutable="false">
    <bpmn:choreographyTask id="Chore_1" name="Exchange" />
    <bpmn:choreographyTask id="Chore_2" name="Second" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diag_B">
    <bpmndi:BPMNPlane id="Plane_B" bpmnElement="Process_B">
      <bpmndi:BPMNShape id="Chore_1_di" bpmnElement="Chore_1">
        <dc:Bounds x="100" y="100" width="120" height="90" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Chore_2_di" bpmnElement="Chore_2">
        <dc:Bounds x="300" y="100" width="120" height="90" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

function loadExample(): Promise<Loaded> {
  return loadCanvas(exampleXml(EXAMPLE));
}

// --- live-tree readers (never the scene) -------------------------------------

async function toXML(loaded: Loaded): Promise<string> {
  const { xml } = await loaded.moddle.toXML(loaded.definitions);
  return xml;
}

async function roundTrip(loaded: Loaded): Promise<{ xml: string; reloaded: any }> {
  const xml = await toXML(loaded);
  const { rootElement: reloaded } = await freshModdle().fromXML(xml);
  return { xml, reloaded };
}

/** The business object of `id` anywhere in a (possibly reloaded) tree. */
function boOf(definitions: any, id: string): any {
  let found: any;
  const visit = (value: any, seen: Set<any>): void => {
    if (found || !value || typeof value !== 'object' || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      for (const item of value) visit(item, seen);
      return;
    }
    if (typeof value.$type !== 'string') return;
    if (value.id === id) {
      found = value;
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (key.startsWith('$')) continue;
      visit(child, seen);
    }
  };
  visit(definitions, new Set());
  return found;
}

/** Every `<dc:Bounds …/>` tag of the serialized document, in document order. */
function boundsTags(xml: string): string[] {
  return xml.match(/<dc:Bounds[^>]*\/>/g) ?? [];
}

function node(canvas: Canvas, id: string): SceneNode {
  return canvas.getScene()!.elementsById.get(id) as SceneNode;
}

/** An element's business object, untyped — moddle's `get` is untyped upstream. */
function bo(element: SceneNode): any {
  return element.businessObject;
}

/** All text drawn inside an element's `<g>`. */
function renderedText(canvas: Canvas, id: string): string {
  const g = canvas.getGraphics(id);
  return Array.from(g?.querySelectorAll('text') ?? [])
    .map((t) => t.textContent ?? '')
    .join(' ');
}

// --- the fixture is what we think it is --------------------------------------

test('the choreography_demo example is a choreography root with two shared participants', async () => {
  const { canvas, definitions } = await loadExample();
  const root = definitions.rootElements.find((re: any) => re.$type === 'bpmn:Choreography');
  expect(root).toBeTruthy();
  expect(root.get('participants').map((p: any) => p.id)).toEqual([
    'Participant_Subject',
    'Participant_Experimenter',
  ]);

  // All three tasks reference the SAME two participants — which is why one rename
  // has to invalidate three bands.
  for (const id of ['Consent', 'Round', 'Round2']) {
    const task = node(canvas, id);
    expect(task.type).toBe('bpmn:ChoreographyTask');
    const refs: any[] = bo(task).participantRef;
    expect(refs.map((p: any) => p.id)).toEqual(['Participant_Subject', 'Participant_Experimenter']);
  }
  // The initiator differs per task, so it is a real per-task fact.
  expect(readChoreographyBands(bo(node(canvas, 'Consent'))).initiator).toBe('top');
  expect(readChoreographyBands(bo(node(canvas, 'Round'))).initiator).toBe('bottom');
});

test('the canvas band reader agrees with @core/document/choreography', async () => {
  const { canvas } = await loadExample();
  expect(DEFAULT_TOP).toBe('Participant A');
  expect(DEFAULT_BOTTOM).toBe('Participant B');
  for (const id of ['Consent', 'Round', 'Round2']) {
    const businessObject = bo(node(canvas, id));
    expect(readChoreographyBands(businessObject)).toEqual(coreReadBands(businessObject));
  }
});

// --- band rename -------------------------------------------------------------

test('renaming a band writes the participant name in toXML, not the task name', async () => {
  const loaded = await loadExample();
  const { canvas, definitions } = loaded;
  const before = await toXML(loaded);
  const task = node(canvas, 'Consent');

  expect(canvas.setBandName(task, 'top', 'Volunteer')).toBe(true);

  // The participant moddle object was mutated in place…
  expect(boOf(definitions, 'Participant_Subject').get('name')).toBe('Volunteer');
  // …and neither the task's own name nor the other participant moved.
  expect(bo(task).get('name')).toBe('Give consent');
  expect(boOf(definitions, 'Participant_Experimenter').get('name')).toBe('Experimenter');

  const { xml, reloaded } = await roundTrip(loaded);
  expect(xml).toContain('<bpmn2:participant id="Participant_Subject" name="Volunteer" />');
  expect(xml).not.toContain('name="Subject"');
  expect(boOf(reloaded, 'Participant_Subject').name).toBe('Volunteer');
  expect(boOf(reloaded, 'Consent').name).toBe('Give consent');
  // Reading the reloaded document back through core's own function returns exactly
  // what was written — the inverse round-trips.
  expect(coreReadBands(boOf(reloaded, 'Consent'))).toEqual({
    top: 'Volunteer',
    bottom: 'Experimenter',
    initiator: 'top',
  });

  // Nothing geometric moved: every `dc:Bounds` is byte-identical.
  expect(boundsTags(xml)).toEqual(boundsTags(before));
});

test('a renamed participant restains every task that draws a band for it', async () => {
  const loaded = await loadExample();
  const { canvas } = loaded;
  const changed: ElementChangedEvent[] = [];
  canvas.getEventBus().on<ElementChangedEvent>('element.changed', (e) => changed.push(e));

  expect(canvas.setBandName(node(canvas, 'Consent'), 'bottom', 'Researcher')).toBe(true);

  for (const id of ['Consent', 'Round', 'Round2']) {
    expect(renderedText(canvas, id)).toContain('Researcher');
    expect(renderedText(canvas, id)).not.toContain('Experimenter');
  }
  expect(new Set(changed.map((e) => e.element.id))).toEqual(new Set(['Consent', 'Round', 'Round2']));
  // One write, one revision bump — however many depictions went stale.
  expect(canvas.getScene()!.revision).toBe(1);
});

test('renaming a band to the text it already has writes nothing at all', async () => {
  const loaded = await loadExample();
  const { canvas } = loaded;
  const before = await toXML(loaded);

  expect(canvas.setBandName(node(canvas, 'Consent'), 'top', 'Subject')).toBe(false);
  expect(canvas.getScene()!.revision).toBe(0);
  expect(await toXML(loaded)).toBe(before);
});

test('a band edit is refused on anything that is not a choreography task', async () => {
  const loaded = await loadExample();
  const { canvas } = loaded;
  const start = node(canvas, 'Start');
  expect(canvas.setBandName(start, 'top', 'Nope')).toBe(false);
  expect(canvas.setInitiator(start, 'bottom')).toBe(false);
  expect(canvas.getScene()!.revision).toBe(0);
  // A start event has no `participantRef` at all — nothing was invented on it.
  expect(bo(start).get('participantRef')).toBeUndefined();
  expect(bo(start).get('initiatingParticipantRef')).toBeUndefined();
});

// --- minting the pair --------------------------------------------------------

test('a band edit on a task with no participants mints the pair and a collaboration', async () => {
  const loaded = await loadCanvas(BARE_XML);
  const { canvas } = loaded;
  const task = node(canvas, 'Chore_1');
  expect(bo(task).get('participantRef')).toHaveLength(0);
  // With no participants the bands read as the placeholders.
  expect(readChoreographyBands(bo(task))).toEqual({
    top: DEFAULT_TOP,
    bottom: DEFAULT_BOTTOM,
    initiator: 'top',
  });

  expect(canvas.setBandName(task, 'bottom', 'Experimenter')).toBe(true);

  const refs = bo(task).get('participantRef');
  expect(refs).toHaveLength(2);
  expect(refs[0].get('name')).toBe(DEFAULT_TOP);
  expect(refs[1].get('name')).toBe('Experimenter');
  // The initiator defaults to the top band, as core's own rewrite does.
  expect(bo(task).get('initiatingParticipantRef')).toBe(refs[0]);

  const { xml, reloaded } = await roundTrip(loaded);
  // A `bpmn:Participant` is not a root element, so the pair needs a holder: a
  // collaboration with NO DI plane, so it lives in the XML without drawing.
  expect(xml).toContain('<bpmn:collaboration');
  expect(xml).toContain('name="Experimenter"');
  expect((xml.match(/<bpmndi:BPMNDiagram/g) ?? [])).toHaveLength(1);

  const reloadedTask = boOf(reloaded, 'Chore_1');
  expect(coreReadBands(reloadedTask)).toEqual({
    top: DEFAULT_TOP,
    bottom: 'Experimenter',
    initiator: 'top',
  });
});

test('minting the pair counts as an edit even when the typed text matches the placeholder', async () => {
  const loaded = await loadCanvas(BARE_XML);
  const { canvas } = loaded;
  const task = node(canvas, 'Chore_1');

  // The text is unchanged, but the document gained two participants and a holder.
  expect(canvas.setBandName(task, 'top', DEFAULT_TOP)).toBe(true);
  expect(canvas.getScene()!.revision).toBe(1);
  expect(bo(task).get('participantRef')).toHaveLength(2);

  const { xml } = await roundTrip(loaded);
  expect(xml).toContain(`name="${DEFAULT_TOP}"`);
});

test('a second task mints its own pair; the two do not share participants', async () => {
  const loaded = await loadCanvas(BARE_XML);
  const { canvas } = loaded;
  canvas.setBandName(node(canvas, 'Chore_1'), 'top', 'A');
  canvas.setBandName(node(canvas, 'Chore_2'), 'top', 'B');

  const first: any[] = bo(node(canvas, 'Chore_1')).get('participantRef');
  const second: any[] = bo(node(canvas, 'Chore_2')).get('participantRef');
  expect(first[0]).not.toBe(second[0]);
  // Both pairs land in the ONE collaboration the first edit created.
  const { xml, reloaded } = await roundTrip(loaded);
  expect((xml.match(/<bpmn:collaboration/g) ?? [])).toHaveLength(1);
  const collaboration = reloaded.rootElements.find((re: any) => re.$type === 'bpmn:Collaboration');
  expect(collaboration.participants).toHaveLength(4);
  // Every id is unique, so nothing the reload resolves is ambiguous.
  const ids = collaboration.participants.map((p: any) => p.id);
  expect(new Set(ids).size).toBe(4);
});

// --- the initiator -----------------------------------------------------------

test('setInitiator moves initiatingParticipantRef and survives a round trip', async () => {
  const loaded = await loadExample();
  const { canvas } = loaded;
  const before = await toXML(loaded);
  const task = node(canvas, 'Consent');
  expect(readChoreographyBands(bo(task)).initiator).toBe('top');

  expect(canvas.setInitiator(task, 'bottom')).toBe(true);
  expect(bo(task).get('initiatingParticipantRef').id).toBe('Participant_Experimenter');

  const { xml, reloaded } = await roundTrip(loaded);
  expect(xml).toContain('initiatingParticipantRef="Participant_Experimenter"');
  expect(coreReadBands(boOf(reloaded, 'Consent')).initiator).toBe('bottom');
  // The sibling tasks keep their own initiators — this is a per-task fact.
  expect(coreReadBands(boOf(reloaded, 'Round')).initiator).toBe('bottom');
  expect(coreReadBands(boOf(reloaded, 'Round2')).initiator).toBe('top');
  expect(boundsTags(xml)).toEqual(boundsTags(before));
});

test('setInitiator to the side that already initiates writes nothing', async () => {
  const loaded = await loadExample();
  const { canvas } = loaded;
  const before = await toXML(loaded);
  expect(canvas.setInitiator(node(canvas, 'Consent'), 'top')).toBe(false);
  expect(canvas.getScene()!.revision).toBe(0);
  expect(await toXML(loaded)).toBe(before);
});

test('swapInitiator flips the shaded band, and flipping twice restores the document', async () => {
  const loaded = await loadExample();
  const { canvas } = loaded;
  const before = await toXML(loaded);
  const task = node(canvas, 'Round');
  expect(readChoreographyBands(bo(task)).initiator).toBe('bottom');

  expect(canvas.swapInitiator(task)).toBe(true);
  expect(readChoreographyBands(bo(task)).initiator).toBe('top');
  expect(await toXML(loaded)).toContain('initiatingParticipantRef="Participant_Subject"');

  expect(canvas.swapInitiator(task)).toBe(true);
  expect(await toXML(loaded)).toBe(before);
});

// --- band colour --------------------------------------------------------------

/**
 * Band shading of a COLOURED choreography task (parity addendum "ChoreographyTask
 * band coloring", from a bpmn-js reference screenshot):
 *
 * - the body takes the chosen fill,
 * - the INITIATING band stays near-white — the convention that makes the initiator
 *   readable whatever colour the task is,
 * - the NON-INITIATING band is the chosen fill DARKENED (it used to stay flat gray,
 *   which is the bug this addendum names),
 * - every stroke is the chosen stroke.
 *
 * The fills are read off the drawn `data-band` paths, which is why the renderer
 * labels them; an uncoloured task must keep the white/`#ededed` pair it always drew.
 */

/** The fill of one drawn participant band. */
function bandFill(canvas: Canvas, id: string, band: 'top' | 'bottom'): string {
  const path = canvas.getGraphics(id)?.querySelector(`[data-band="${band}"]`);
  if (!path) throw new Error(`no ${band} band drawn for ${id}`);
  return path.getAttribute('fill') ?? '';
}

/** The fill of the task body — the first rect drawn inside the element's `<g>`. */
function bodyFill(canvas: Canvas, id: string): string {
  return canvas.getGraphics(id)?.querySelector('rect')?.getAttribute('fill') ?? '';
}

/** Every stroke colour drawn inside an element, deduplicated. */
function strokes(canvas: Canvas, id: string): string[] {
  const drawn = Array.from(canvas.getGraphics(id)?.querySelectorAll('[stroke]') ?? [])
    .map((el) => el.getAttribute('stroke'))
    .filter((stroke): stroke is string => !!stroke && stroke !== 'none');
  return [...new Set(drawn)];
}

test('colouring a choreography task fills the body, keeps the initiating band light and darkens the other', async () => {
  const loaded = await loadExample();
  const { canvas } = loaded;
  const task = node(canvas, 'Consent');
  // `Consent` initiates at the TOP (asserted above), so the bottom band is the
  // receiving one and is the band that has to darken.
  expect(readChoreographyBands(bo(task)).initiator).toBe('top');

  expect(canvas.setColor(task, { fill: '#e8bcbc', stroke: '#8f3a3a' })).toHaveLength(1);

  expect(bodyFill(canvas, 'Consent')).toBe('#e8bcbc');
  expect(bandFill(canvas, 'Consent', 'top')).toBe('#ffffff');
  // 12% down each channel of the chosen fill: darker than the body, same hue.
  expect(bandFill(canvas, 'Consent', 'bottom')).toBe('#cca5a5');
  expect(strokes(canvas, 'Consent')).toEqual(['#8f3a3a']);

  // The DI is where the colour lives; the bands are derived paint, never stored.
  const { xml } = await roundTrip(loaded);
  expect(xml).toContain('background-color="#e8bcbc"');
  expect(xml).not.toContain('#cca5a5');
});

test('the darkened band follows the initiator, not the band position', async () => {
  const { canvas } = await loadExample();
  const task = node(canvas, 'Round');
  expect(readChoreographyBands(bo(task)).initiator).toBe('bottom');

  canvas.setColor(task, { fill: '#88aaff' });
  expect(bandFill(canvas, 'Round', 'bottom')).toBe('#ffffff');
  expect(bandFill(canvas, 'Round', 'top')).toBe('#7896e0');

  // Flipping who initiates swaps which band is light, with no further colour edit.
  canvas.swapInitiator(task);
  expect(bandFill(canvas, 'Round', 'top')).toBe('#ffffff');
  expect(bandFill(canvas, 'Round', 'bottom')).toBe('#7896e0');
});

test('an UNCOLOURED task shades by the initiator too, on the element the addendum shows', async () => {
  // `First decision round` is the exact task the parity addendum's reference
  // screenshot was taken of, and the shipped document says
  // `initiatingParticipantRef="Participant_Experimenter"` with no
  // `participantBandKind` anywhere. So the Experimenter's band — the BOTTOM one —
  // is the light one, and the Subject's is the shaded one. The reference screenshot
  // shows the opposite pair, which means it disagrees with the document rather than
  // with the rule: whichever participant initiates gets the near-white band.
  const { canvas } = await loadExample();
  expect(readChoreographyBands(bo(node(canvas, 'Round'))).initiator).toBe('bottom');
  expect(bandFill(canvas, 'Round', 'bottom')).toBe('#ffffff');
  expect(bandFill(canvas, 'Round', 'top')).toBe('#ededed');

  // …and the sibling task, which names the OTHER participant, is shaded the other
  // way round — from the same rule, with no band-position special case.
  expect(readChoreographyBands(bo(node(canvas, 'Consent'))).initiator).toBe('top');
  expect(bandFill(canvas, 'Consent', 'top')).toBe('#ffffff');
  expect(bandFill(canvas, 'Consent', 'bottom')).toBe('#ededed');
});

test('clearing the colour restores the default gray bands', async () => {
  const loaded = await loadExample();
  const { canvas } = loaded;
  const before = await toXML(loaded);
  const task = node(canvas, 'Consent');

  // The uncoloured pair, before anything is written…
  expect(bandFill(canvas, 'Consent', 'top')).toBe('#ffffff');
  expect(bandFill(canvas, 'Consent', 'bottom')).toBe('#ededed');

  canvas.setColor(task, { fill: '#e8bcbc', stroke: '#8f3a3a' });
  expect(bandFill(canvas, 'Consent', 'bottom')).toBe('#cca5a5');

  canvas.setColor(task, { fill: null, stroke: null });
  expect(bodyFill(canvas, 'Consent')).toBe('#ffffff');
  expect(bandFill(canvas, 'Consent', 'top')).toBe('#ffffff');
  expect(bandFill(canvas, 'Consent', 'bottom')).toBe('#ededed');
  // …and clearing really removed the attributes, rather than writing a default.
  expect(await toXML(loaded)).toBe(before);
});

// --- band geometry -----------------------------------------------------------

test('band geometry is derived from the single dc:Bounds and stays consistent', async () => {
  const loaded = await loadExample();
  const { canvas } = loaded;
  const task = node(canvas, 'Consent');
  const di = task.di as any;

  // Three bands out of one bounds: two ≤20-high participant bands and the rest.
  const band = choreographyBandHeight(task.height);
  expect(band).toBeGreaterThan(0);
  expect(2 * band).toBeLessThan(task.height);
  expect(band).toBe(Math.min(20, Math.floor(di.bounds.height / 3)));

  // A rename cannot move a band: the DI has no per-band geometry to fall out of step.
  canvas.setBandName(task, 'top', 'A rather much longer participant name');
  canvas.setInitiator(task, 'bottom');
  expect(di.bounds.height).toBe(task.height);
  expect(choreographyBandHeight(task.height)).toBe(band);
  expect((task.di as any).$descriptor?.propertiesByName?.participantBandKind).toBeTruthy();
  // …and no participant-band `BPMNShape` was invented for the document.
  const { xml } = await roundTrip(loaded);
  expect(xml).not.toContain('participantBandKind');
  expect(xml).not.toContain('choreographyActivityShape');
});

test('a resized choreography task keeps all three bands drawable', async () => {
  const loaded = await loadCanvas(BARE_XML);
  const { canvas } = loaded;
  const task = node(canvas, 'Chore_1');
  const minimum = canvas.getRules().canResize(task, { width: 100, height: 80 });
  expect(minimum).toBe(true);
  // The `bpmn:ChoreographyActivity` floor (100×80) is what keeps the bands drawable.
  expect(canvas.getRules().canResize(task, { width: 100, height: 40 })).toBe(false);

  canvas.getWriteback()!.setNodeBounds(task, { width: 100, height: 80 });
  const band = choreographyBandHeight(task.height);
  expect(band).toBe(20);
  expect(task.height - 2 * band).toBeGreaterThan(0);
  const { xml } = await roundTrip(loaded);
  expect(xml).toContain('width="100" height="80"');
});
