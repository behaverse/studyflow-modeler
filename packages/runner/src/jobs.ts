import type { FlowNode } from '@runner/flow';

// With no node modules loaded (e.g. Node-side unit tests) `Job` falls back to the shared shape, not `never`.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface JobsByType {}

export type Job = [keyof JobsByType] extends [never]
  ? { type: string; node: FlowNode }
  : JobsByType[keyof JobsByType];
