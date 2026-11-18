import { createContext } from 'react';
import type { Editor } from '@modeler/editor/port';

const noop = () => {};

/** The editor, once booted; App renders nothing that reads it before then. */
export const ModelerContext = createContext<Editor | undefined>(undefined);

export const SettingsViewContext = createContext<{
  openSettings: () => void;
}>({ openSettings: noop });

/** What the app is doing: editing, simulating, or replaying the provenance trail, which wins over a simulation. */
export type AppMode = 'edit' | 'simulation' | 'replay' | 'review';

/**
 * The app's mode, and the way into and out of a replay, where the inspector yields to the replay panel and the canvas
 * animates the trail. The canvas frame, the nav bar and the panels all follow `mode`.
 */
export const ModeContext = createContext<{ mode: AppMode; openReplay: () => void; exitReplay: () => void }>({
  mode: 'edit',
  openReplay: noop,
  exitReplay: noop,
});
