import { createContext } from 'react';
import type { Editor } from '@modeler/editor/port';

const noop = () => {};

export const ModelerContext = createContext<{
  modeler: Editor | undefined;
  setModeler: (modeler: Editor | undefined) => void;
}>({ modeler: undefined, setModeler: noop });

export const SettingsViewContext = createContext<{
  openSettings: () => void;
}>({ openSettings: noop });

/** Provenance replay mode: the inspector yields to the replay panel and the canvas animates the trail. */
export const ReplayContext = createContext<{
  isReplaying: boolean;
  openReplay: () => void;
  closeReplay: () => void;
}>({ isReplaying: false, openReplay: noop, closeReplay: noop });
