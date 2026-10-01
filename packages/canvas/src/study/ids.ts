/** Document-scoped id minting, seeded from everything the imported tree already carries. */

import { toLocalName } from '@core/naming.ts';

import type { Element, StudyModel } from '@core/model/index.ts';
import type { Ids } from '@core/model/items.ts';

/** `'bpmn:UserTask'` → `'UserTask_'`. */
export function prefixFor(type: string): string {
  return `${toLocalName(type) ?? type}_`;
}

/** The types that carry an id (bpmn-js's `BpmnFactory` list). */
const ID_BEARING_TYPES = [
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

export function needsId(model: StudyModel, element: Element): boolean {
  return ID_BEARING_TYPES.some((type) => model.isA(element, type));
}

/** bpmn-js's semantic prefixes (`bpmn:UserTask` → `Activity_`). */
export function idPrefixFor(model: StudyModel, element: Element): string {
  if (model.isA(element, 'bpmn:Activity')) return 'Activity_';
  if (model.isA(element, 'bpmn:Event')) return 'Event_';
  if (model.isA(element, 'bpmn:Gateway')) return 'Gateway_';
  if (model.isA(element, 'bpmn:SequenceFlow') || model.isA(element, 'bpmn:MessageFlow')) return 'Flow_';
  return prefixFor(model.host(element));
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

  nextPrefixed(prefix: string): string {
    let id: string;
    do {
      this.counter += 1;
      id = `${prefix}${this.counter.toString(36).padStart(4, '0')}`;
    } while (this.taken.has(id));
    this.taken.add(id);
    return id;
  }

  next(type: string): string {
    return this.nextPrefixed(prefixFor(type));
  }

  /** `base`, else `base_2`, `base_3`…: the first id no element holds, claimed. */
  free(base: string): string {
    let id = base;
    for (let n = 2; this.taken.has(id); n += 1) id = `${base}_${n}`;
    this.taken.add(id);
    return id;
  }

  /** The minting core's model writers take. */
  get minter(): Ids {
    return { next: (prefix) => this.nextPrefixed(prefix), free: (base) => this.free(base) };
  }

  /** Every id `model` holds claimed. */
  static fromModel(model: StudyModel): IdGenerator {
    const ids = new IdGenerator();
    for (const element of model.all()) ids.claim(element.id);
    return ids;
  }
}
