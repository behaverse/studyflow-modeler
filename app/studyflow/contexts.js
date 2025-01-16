import { createContext } from 'react';

export const ModelerContext = createContext({
    modeler: undefined,
});


export const APIKeyContext = createContext({
    apiKey: undefined,
    setApiKey: undefined,
});
