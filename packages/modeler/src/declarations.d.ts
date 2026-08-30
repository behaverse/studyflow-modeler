/// <reference types="vite/client" />

/** Shims for the two dependencies that ship no types of their own. */

declare module 'bpmn-auto-layout' {
  /** Add BPMN DI (a left-to-right layout) to a BPMN 2.0 XML string that has none. */
  export function layoutProcess(xml: string): Promise<string>;
}

declare module 'downloadjs' {
  /** Trigger a browser download of `data` as `filename`. */
  export default function download(
    data: Blob | string,
    filename?: string,
    mimeType?: string,
  ): boolean;
}
