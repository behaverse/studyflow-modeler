/** Document-scoped id minting, seeded from everything the imported tree already carries. */

import { toLocalName } from '@core/naming.ts';

import type { StudyModel } from '@core/model/index.ts';
import type { Ids } from '@core/model/items.ts';

/** `'bpmn:UserTask'` → `'UserTask_'`. */
export function prefixFor(type: string): string {
  return `${toLocalName(type) ?? type}_`;
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
