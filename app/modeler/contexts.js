import { createContext } from 'react';

export const ModelerContext = createContext({
    modeler: undefined,
    setModeler: undefined,
});


export const APIKeyContext = createContext({
    apiKey: undefined,
    setApiKey: undefined,
});



export const PropertiesPanelContext = createContext({
    element: undefined,
    businessObject: undefined,
});
