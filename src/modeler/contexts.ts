import { createContext } from 'react';

const noop = () => {};

export const ModelerContext = createContext<{
  modeler: any;
  setModeler: (modeler: any) => void;
}>({ modeler: undefined, setModeler: noop });

export const InspectorContext = createContext<{ element: any | undefined }>({
  element: undefined,
});

export const SettingsViewContext = createContext<{
  openSettings: () => void;
}>({ openSettings: noop });
