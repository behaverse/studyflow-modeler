import { createContext } from 'react';
import type { Editor } from '@modeler/editor/port';

const noop = () => {};

/** The editor, once booted; App renders nothing that reads it before then. */
export const ModelerContext = createContext<Editor | undefined>(undefined);

export const SettingsViewContext = createContext<{
  openSettings: () => void;
}>({ openSettings: noop });

/** Provenance replay mode: the inspector yields to the replay panel and the canvas animates the trail. */
export const ReplayContext = createContext<{ openReplay: () => void }>({ openReplay: noop });
