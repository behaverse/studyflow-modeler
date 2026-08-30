/**
 * Prefixed id generation for the scene (design §3 "Scene model", `model/ids.ts`).
 *
 * Mirrors `model/build.ts`'s `buildBusinessObject` contract — a
 * `nextPrefixed(prefix, element)` that hands back a document-unique id derived
 * from a type-local prefix (e.g. `'UserTask_'`) — but is self-contained: it must
 * not pull in bpmn-js's `moddle.ids` service (a bare `bpmn-moddle` instance has
 * no `.ids`), and the canvas ships no extra runtime dependency for it.
 *
 * At import the generator is seeded from the live document so every id already in
 * the `Definitions` tree (business objects *and* DI) is claimed; later phases
 * (`model/writeback.ts`) draw fresh ids from the same instance when they create
 * business-object + DI pairs, so nothing collides with what the document held.
 */

import { toLocalName } from '@core/naming.ts';

import type { ModdleObject } from '@canvas/model/scene.ts';

/** The id-local prefix for a business object of `$type`, e.g. `'bpmn:UserTask'` → `'UserTask_'`. */
export function prefixFor(type: string): string {
  const local = toLocalName(type) ?? type;
  return `${local}_`;
}

/** A moddle object as the id rules below see it: `$instanceOf` answers type membership. */
type IdBearingCandidate = (ModdleObject & { $instanceOf?: (type: string) => boolean }) | undefined | null;

/**
 * The moddle types bpmn-js's `BpmnFactory` mints ids for. Mirrored so a business
 * object built through `EditorModel.createBusinessObject` is numbered the way the
 * documents in the wild are (`ExtensionElements` and friends stay id-less, as upstream).
 */
export const ID_BEARING_TYPES = [
  'bpmn:RootElement',
  'bpmn:FlowElement',
  'bpmn:MessageFlow',
  'bpmn:DataAssociation',
  'bpmn:Artifact',
  'bpmn:Participant',
  'bpmn:Lane',
  'bpmn:LaneSet',
  'bpmn:Process',
  'bpmn:Collaboration',
  'bpmndi:BPMNShape',
  'bpmndi:BPMNEdge',
  'bpmndi:BPMNDiagram',
  'bpmndi:BPMNPlane',
  'bpmn:Property',
  'bpmn:CategoryValue',
];

export function needsId(element: IdBearingCandidate): boolean {
  return ID_BEARING_TYPES.some((type) => element?.$instanceOf?.(type));
}

/** bpmn-js's semantic id prefixes (`bpmn:UserTask` → `Activity_`), reimplemented. */
export function idPrefixFor(element: IdBearingCandidate): string {
  if (element?.$instanceOf?.('bpmn:Activity')) return 'Activity_';
  if (element?.$instanceOf?.('bpmn:Event')) return 'Event_';
  if (element?.$instanceOf?.('bpmn:Gateway')) return 'Gateway_';
  if (element?.$instanceOf?.('bpmn:SequenceFlow') || element?.$instanceOf?.('bpmn:MessageFlow')) return 'Flow_';
  return prefixFor(String(element?.$type ?? ''));
}

/**
 * A monotone, collision-free id source scoped to one document. `claim`/`assigned`
 * track the taken set; `next`/`nextPrefixed` mint a fresh id and claim it in one
 * step (the shape `moddle.ids.nextPrefixed` exposes, so the writeback code and the
 * eventual `EditorModel` bridge can treat the two interchangeably).
 */
export class IdGenerator {
  private readonly taken = new Set<string>();
  private counter = 0;

  /** Reserve `id` so no later `next*` call returns it. No-op for an empty id. */
  claim(id: string | undefined): void {
    if (id) this.taken.add(id);
  }

  /** Whether `id` is already reserved. */
  assigned(id: string | undefined): boolean {
    return !!id && this.taken.has(id);
  }

  /** A fresh unique id carrying `prefix`; the `element` argument mirrors the moddle signature and is unused. */
  nextPrefixed(prefix: string, _element?: ModdleObject): string {
    let id: string;
    do {
      this.counter += 1;
      id = `${prefix}${this.token(this.counter)}`;
    } while (this.taken.has(id));
    this.taken.add(id);
    return id;
  }

  /** A fresh unique id carrying the id-local prefix for `type`. */
  next(type: string, element?: ModdleObject): string {
    return this.nextPrefixed(prefixFor(type), element);
  }

  /** Reserve every id already present in a `Definitions` tree (business objects and DI). */
  static fromDefinitions(definitions: ModdleObject | undefined): IdGenerator {
    const ids = new IdGenerator();
    ids.seed(definitions);
    return ids;
  }

  /** Walk an arbitrary moddle subtree and claim every `id` it carries. */
  seed(root: ModdleObject | undefined): void {
    const seen = new Set<unknown>();
    const visit = (value: unknown): void => {
      if (!value || typeof value !== 'object' || seen.has(value)) return;
      seen.add(value);
      if (Array.isArray(value)) {
        for (const item of value) visit(item);
        return;
      }
      const record = value as Record<string, unknown>;
      if (typeof record.$type !== 'string') return; // only descend moddle elements
      if (typeof record.id === 'string') this.claim(record.id);
      for (const [key, child] of Object.entries(record)) {
        if (key === '$parent' || key.startsWith('$')) continue; // avoid cycles / bookkeeping
        visit(child);
      }
    };
    visit(root);
  }

  private token(n: number): string {
    // Short, id-safe, and stable per document: a zero-padded base-36 counter.
    return n.toString(36).padStart(4, '0');
  }
}
