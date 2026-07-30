import { AttributeFields } from '@/modeler/views/inspector/AttributeField';
import { LoopSection } from '@/modeler/views/inspector/LoopSection';
import { StateSection } from '@/modeler/views/inspector/StateSection';
import { DataFlowSection } from '@/modeler/views/inspector/DataFlowSection';

/**
 * The Execution tab: what runs, what state the element declares, what flows in
 * and out of it, and last, how often the whole thing repeats.
 *
 * Declarations before use — the properties are what this element *has*, and the
 * two wire lists are where those values come from and go to, so they read
 * together rather than with the state wedged between them. Repetition applies to
 * all of it, so it comes after rather than between.
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
      <StateSection />
      <DataFlowSection direction="input" />
      <DataFlowSection direction="output" />
      <LoopSection />
    </>
  );
}
