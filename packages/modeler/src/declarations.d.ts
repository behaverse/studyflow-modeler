/// <reference types="vite/client" />

/** A shim for the dependency that ships no types of its own. */

declare module 'bpmn-auto-layout' {
  /** Add BPMN DI (a left-to-right layout) to a BPMN 2.0 XML string that has none. */
  export function layoutProcess(xml: string): Promise<string>;
}
