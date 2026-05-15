// Runtime-local types. Flow data structures live in @/lib/core/flow.
// Job / JobsByKind stay here because each runtime node module augments
// JobsByKind to register its own job type.

/**
 * Map of registered node kinds to their job types. Each node module under
 * src/runtime/nodes/<kind>/index.tsx augments this interface; the `Job` union
 * below is derived from it, so adding a new kind requires no edit here.
 *
 * In a node module:
 *   declare module '@/runner/types' {
 *     interface JobsByKind { myKind: MyKindJob; }
 *   }
 */
export interface JobsByKind {}
export type Job = JobsByKind[keyof JobsByKind];
