/// <reference types="vite/client" />
/// <reference path="./assets/declarations.d.ts" />

declare module 'bpmn-moddle' {
  export class BpmnModdle {
    constructor(packages?: Record<string, any>);
    fromXML(xml: string): Promise<{ rootElement: any; warnings: string[] }>;
    toXML(element: any, options?: { format?: boolean }): Promise<{ xml: string }>;
    create(type: string, attrs?: Record<string, any>): any;
    getTypeDescriptor(typeName: string): any;
    getPropertyDescriptor(element: any, propertyName: string): any;
    ids: { nextPrefixed(prefix: string): string };
    registry: {
      typeMap: Record<string, any>;
      packageMap: Record<string, any>;
      getEffectiveDescriptor(typeName: string): any;
    };
  }
}
