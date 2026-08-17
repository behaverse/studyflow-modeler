/** bpmn-moddle ships no types of its own; this shim is shared by every package in the program. */
declare module 'bpmn-moddle' {
  export class BpmnModdle {
    constructor(packages?: Record<string, any>);
    fromXML(xml: string): Promise<{ rootElement: any; warnings: string[] }>;
    toXML(element: any, options?: { format?: boolean }): Promise<{ xml: string }>;
    create(type: string, attrs?: Record<string, any>): any;
    getTypeDescriptor(typeName: string): any;
    getElementDescriptor(element: any): any;
    getPropertyDescriptor(element: any, propertyName: string): any;
    ids: { nextPrefixed(prefix: string): string };
    registry: {
      typeMap: Record<string, any>;
      packageMap: Record<string, any>;
      getEffectiveDescriptor(typeName: string): any;
    };
  }
}
// Vite static-asset imports resolve to a URL string.
declare module '*.png' { const value: string; export default value; }
declare module '*.jpeg' { const value: string; export default value; }
declare module '*.svg' { const value: string; export default value; }
declare module '*.gif' { const value: string; export default value; }
declare module '*.webp' { const value: string; export default value; }
declare module '*.ico' { const value: string; export default value; }
declare module '*.bpmn' { const value: string; export default value; }

