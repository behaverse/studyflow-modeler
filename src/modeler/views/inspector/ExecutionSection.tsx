import { AttributeFields } from '@/modeler/views/inspector/AttributeField';
import { LoopSection } from '@/modeler/views/inspector/LoopSection';
import { StateSection } from '@/modeler/views/inspector/StateSection';
import { DataFlowSection } from '@/modeler/views/inspector/DataFlowSection';

/**
 * The Execution tab, in the order a step is read as one call: what runs, what
 * goes in, what comes out, how often it repeats, and what state it carries of
 * its own.
 *
 * Function and its arguments are catalog fields (`bpmn:implementation`,
 * `arguments`); repetition is the `loopCharacteristics` child; inputs and
 * outputs are the data associations; the properties are the `bpmn:Property`
 * children. Only the first of those is reachable through the catalog, which is
 * why the rest are drawn here — but a reader has no reason to care about that
 * boundary, so nothing in the tab marks it. One flat run of sections, each
 * named for the thing it holds.
 */
export function ExecutionSection({ attrDefs }: { attrDefs: any[] }) {
  return (
    <>
      <AttributeFields attrDefs={attrDefs} />
      <DataFlowSection />
      <LoopSection />
      <StateSection />
    </>
  );
}
