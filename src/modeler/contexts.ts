import { createContext } from 'react';

export const ModelerContext = createContext<{
    modeler: any,
    setModeler: (modeler: any) => void,
}>({
    modeler: undefined,
    setModeler: () => {},
});

export const DiagramNameContext = createContext<{
    diagramName: string,
    setDiagramName: (name: string) => void,
}>({
    diagramName: 'Untitled Diagram',
    setDiagramName: () => {},
});

export const APIKeyContext = createContext<{
    apiKey: string | undefined,
    setApiKey: (key: string) => void,
}>({
    apiKey: undefined,
    setApiKey: () => {},
});


export const InspectorContext = createContext({
    element: undefined,
    businessObject: undefined,
});

export const SettingsViewContext = createContext<{
    isSettingsOpen: boolean,
    openSettings: () => void,
    closeSettings: () => void,
}>({
    isSettingsOpen: false,
    openSettings: () => {},
    closeSettings: () => {},
});

export const SimulationContext = createContext<{
    isSimulating: boolean,
    setIsSimulating: (v: boolean) => void,
}>({
    isSimulating: false,
    setIsSimulating: () => {},
});
