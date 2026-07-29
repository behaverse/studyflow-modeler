import { StateSection } from '@/modeler/views/inspector/StateSection';
import { DataFlowSection } from '@/modeler/views/inspector/DataFlowSection';

/**
 * The Execution tab's model-level sections, in the order the two relate:
 * `bpmn:Property` declarations first, then the data associations that wire
 * them (and the drawn data elements) into this step. They share a tab because
 * they are two halves of one question — what values this element carries, and
 * where each one comes from — and neither is reachable from the catalog's
 * attribute fields, which only resolve attributes on the element itself.
 */
export function ExecutionSection() {
  return (
    <>
      <StateSection />
      <DataFlowSection />
    </>
  );
}
