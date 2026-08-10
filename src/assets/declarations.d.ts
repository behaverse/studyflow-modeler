// Vite static-asset imports resolve to a URL string.
declare module '*.png' { const value: string; export default value; }
declare module '*.jpeg' { const value: string; export default value; }
declare module '*.svg' { const value: string; export default value; }
declare module '*.gif' { const value: string; export default value; }
declare module '*.webp' { const value: string; export default value; }
declare module '*.ico' { const value: string; export default value; }
declare module '*.bpmn' { const value: string; export default value; }

// `*.json` is deliberately NOT declared here: `resolveJsonModule` gives an
// imported JSON file its real inferred type, and an ambient `any` declaration
// would shadow that — which is what erased `locales/en.json`'s key type.