import type { FlowNode } from '@/runner/models/flow';

// Each node module augments `JobsByType` with its type -> job entry; `Job` is
// the union. Those modules are `.tsx` views, so a program that does not pull
// them in (a Node-side unit test of the session, say) sees an empty registry.
// Fall back to the shape every job shares rather than to `never`, which would
// make each `job.type` read an error.
export interface JobsByType {}

export type Job = [keyof JobsByType] extends [never]
  ? { type: string; node: FlowNode }
  : JobsByType[keyof JobsByType];
