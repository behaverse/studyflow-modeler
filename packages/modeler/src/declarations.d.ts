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
