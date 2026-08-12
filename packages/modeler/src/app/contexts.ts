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
