import type { AppMode } from '@modeler/app/contexts';

/**
 * What the composer shows. `home` invites a first step on a blank study, `design` holds the commands and the way to
 * simulate or run, `selection` adds what is selected as their context, `playback` is a simulation's transport,
 * `replay` the run trail's, and `review` a version written into the file elsewhere, to accept or discard.
 */
export type Face = 'home' | 'design' | 'selection' | 'playback' | 'replay' | 'review';

export type FaceInput = {
  mode: AppMode;
  /** The study holds nothing yet but the start event a new study opens with. */
  blank: boolean;
  /** How many elements are selected. */
  selected: number;
};

/** The face is computed from the app's state, never set by hand: the first that applies wins. */
export function faceOf({ mode, blank, selected }: FaceInput): Face {
  if (mode === 'review') return 'review';
  if (mode === 'replay') return 'replay';
  if (mode === 'simulation') return 'playback';
  if (blank) return 'home';
  if (selected > 0) return 'selection';
  return 'design';
}
