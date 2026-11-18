/**
 * The version under review: one written into the linked file by something else (an assistant through `studyflow mcp`,
 * another editor), standing on the canvas until the user accepts or discards it.
 */
import { useSyncExternalStore } from 'react';

/** One element the version adds, changes or removes, as the change list names it. */
export type ReviewChange = {
  id: string;
  kind: 'added' | 'changed' | 'removed';
  /** Its name, else its id. */
  label: string;
  /** Its type's local name: `Task`, `SequenceFlow`, a schema type's. */
  type: string;
  /** What changed on a changed one: the attributes by name, and `drawing` when it moved. */
  what: string[];
};

export type Review = {
  /** The linked file the version came from. */
  file: string;
  /** Its modified time, which the link takes once the version is accepted or discarded. */
  modified: number;
  changes: ReviewChange[];
};

let review: Review | undefined;
const listeners = new Set<() => void>();

export const getReview = (): Review | undefined => review;

export function setReview(next: Review | undefined): void {
  review = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function useReview(): Review | undefined {
  return useSyncExternalStore(subscribe, getReview, getReview);
}
