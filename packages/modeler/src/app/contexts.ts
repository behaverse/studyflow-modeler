import { createContext } from 'react';
import type { Modeler } from '@modeler/bpmn/types';

const noop = () => {};

export const ModelerContext = createContext<{
  modeler: Modeler | undefined;
  setModeler: (modeler: Modeler | undefined) => void;
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
