import { Field, Label } from '@headlessui/react';
import { useEffect, useState } from 'react';
import { useModeler } from '@/modeler/views/useModeler';
import { HelpTooltip } from '@/modeler/views/inspector/HelpTooltip';
import { useInspectedElement } from '@/modeler/views/inspector/hooks/useInspectedElement';
import { getInferredDataNeighbors, type DataNeighbor } from '@/modeler/models/inspector/dataNeighbors';
import { field as s } from '@/modeler/infra/styles';

const DESCRIPTION =
  'Detected from the data associations drawn on the canvas: a wired data '
  + 'element is an input or output of this step. "name → parameter" shows the '
  + 'callable parameter an input binds to (an output arrow shows its '
  + 'transformation expression); without an arrow, the binding defaults '
  + 'to the element\'s name. Edit the wires, not a list.';

/** Read-only view of the step's data contract, derived from the canvas. */
export function DataFlowSection() {
  const element = useInspectedElement();
  const modeler = useModeler();
  const eventBus = modeler.get('eventBus');

  // Wires are drawn on the canvas, not edited here - re-derive on any change.
  const [, setRevision] = useState(0);
  useEffect(() => {
    const bump = () => setRevision((r) => r + 1);
    eventBus.on('elements.changed', bump);
    return () => eventBus.off('elements.changed', bump);
  }, [eventBus]);

  const inputs = getInferredDataNeighbors(element, 'inputs');
  const outputs = getInferredDataNeighbors(element, 'outputs');
  if (inputs.length === 0 && outputs.length === 0) return null;

  const row = (kind: 'input' | 'output', neighbor: DataNeighbor, index: number) => (
    <div key={`${kind}-${index}`} className={s.arrayRow}>
      <input
        readOnly
        value={neighbor.binding ? `${neighbor.name} → ${neighbor.binding}` : neighbor.name}
        className={s.arrayInferredInput}
      />
      <span className={s.arrayInferredLabel}>{kind}</span>
    </div>
  );

  return (
    <Field className={s.field}>
      <Label className={s.label}>
        Data flow
        <HelpTooltip name="Data flow" description={DESCRIPTION} />
      </Label>
      <div className={s.arrayList} data-testid="data-flow-section">
        {inputs.map((neighbor, i) => row('input', neighbor, i))}
        {outputs.map((neighbor, i) => row('output', neighbor, i))}
      </div>
    </Field>
  );
}
