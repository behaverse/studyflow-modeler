/** Document-scoped id minting, seeded from everything the imported tree already carries. */

import { toLocalName } from '@core/naming.ts';

import type { ModdleObject } from '@canvas/model/scene.ts';

/** `'bpmn:UserTask'` → `'UserTask_'`. */
export function prefixFor(type: string): string {
  return `${toLocalName(type) ?? type}_`;
}

type Candidate = (ModdleObject & { $instanceOf?: (type: string) => boolean }) | undefined | null;

/** The moddle types that carry an id (bpmn-js's `BpmnFactory` list). */
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

export function needsId(element: Candidate): boolean {
  return ID_BEARING_TYPES.some((type) => element?.$instanceOf?.(type));
}

/** bpmn-js's semantic prefixes (`bpmn:UserTask` → `Activity_`). */
export function idPrefixFor(element: Candidate): string {
  if (element?.$instanceOf?.('bpmn:Activity')) return 'Activity_';
  if (element?.$instanceOf?.('bpmn:Event')) return 'Event_';
  if (element?.$instanceOf?.('bpmn:Gateway')) return 'Gateway_';
  if (element?.$instanceOf?.('bpmn:SequenceFlow') || element?.$instanceOf?.('bpmn:MessageFlow')) return 'Flow_';
  return prefixFor(String(element?.$type ?? ''));
}

export class IdGenerator {
  private readonly taken = new Set<string>();
  private counter = 0;

  claim(id: string | undefined): void {
    if (id) this.taken.add(id);
  }

  assigned(id: string | undefined): boolean {
    return !!id && this.taken.has(id);
  }

  nextPrefixed(prefix: string, _element?: ModdleObject): string {
    let id: string;
    do {
      this.counter += 1;
      id = `${prefix}${this.counter.toString(36).padStart(4, '0')}`;
    } while (this.taken.has(id));
    this.taken.add(id);
    return id;
  }

  next(type: string, element?: ModdleObject): string {
    return this.nextPrefixed(prefixFor(type), element);
  }

  static fromDefinitions(definitions: ModdleObject | undefined): IdGenerator {
    const ids = new IdGenerator();
    ids.seed(definitions);
    return ids;
  }

  /** Claim every `id` in a moddle subtree. */
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
      if (typeof record.$type !== 'string') return;
      if (typeof record.id === 'string') this.claim(record.id);
      for (const [key, child] of Object.entries(record)) {
        if (!key.startsWith('$')) visit(child);
      }
    };
    visit(root);
  }
}
