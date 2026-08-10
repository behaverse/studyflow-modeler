/// <reference types="vite/client" />

declare module 'bpmn-auto-layout' {
  /** Add BPMN DI (a left-to-right layout) to a BPMN 2.0 XML string that has none. */
  export function layoutProcess(xml: string): Promise<string>;
}

/** Shims for the four dependencies that ship no types of their own. */
declare module 'bpmn-js-color-picker' {
  const BpmnColorPickerModule: import('didi').ModuleDeclaration;
  export default BpmnColorPickerModule;
}

declare module 'bpmn-js-create-append-anything' {
  export const CreateAppendAnythingModule: import('didi').ModuleDeclaration;
  export const CreateAppendElementTemplatesModule: import('didi').ModuleDeclaration;
}

declare module 'diagram-js-grid' {
  const GridModule: import('didi').ModuleDeclaration;
  export default GridModule;
}

declare module 'downloadjs' {
  /** Trigger a browser download of `data` as `filename`. */
  export default function download(
    data: Blob | string,
    filename?: string,
    mimeType?: string,
  ): boolean;
}

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
