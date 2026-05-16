// Each node module augments `JobsByType` with its type -> job entry; `Job` is the union.
export interface JobsByType {}
export type Job = JobsByType[keyof JobsByType];
