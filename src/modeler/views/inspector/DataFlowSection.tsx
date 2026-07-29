import { Input, Listbox, ListboxButton, ListboxOption, ListboxOptions } from '@headlessui/react';
import { useEffect, useState, type ChangeEvent } from 'react';
import { ICONS } from '@/icons';
import { executeCommand } from '@/modeler/controllers/commandBus';
import { useModeler } from '@/modeler/views/useModeler';
import { HelpTooltip } from '@/modeler/views/inspector/HelpTooltip';
import { useInspectedElement } from '@/modeler/views/inspector/hooks/useInspectedElement';
import { getInferredDataNeighbors, type DataNeighbor } from '@/modeler/models/inspector/dataNeighbors';
import { getPropertiesInScope } from '@/modeler/models/inspector/stateProperties';
import { field as s } from '@/modeler/infra/styles';

const DESCRIPTION =
  'This step\'s data associations. A wire to something drawn on the canvas is '
  + 'made by drawing it, and shows here read-only. A property is never drawn, '
  + 'so its wire is made here: add one with +, and it becomes an ordinary '
  + 'bpmn:DataInputAssociation or bpmn:DataOutputAssociation on this step. '
  + 'The second box is the binding — for an input, the callable parameter it '
  + 'fills (blank binds by the property\'s own name); for an output, a '
  + 'transformation over `result` that narrows what lands there. Only '
  + 'properties in scope are offered: this element\'s own, then those of each '
  + 'container around it. Each row is tagged with the BPMN kind it binds, and '
  + 'with the container it comes from when that is not this one — a wire that '
  + 'reaches out of a sub-process is valid BPMN, but its two ends are on '
  + 'different planes, so there is no line to look for on the canvas.';

type Direction = 'input' | 'output';

/** The step's data associations: drawn elements read-only, properties editable. */
export function DataFlowSection() {
  const element = useInspectedElement();
  const modeler = useModeler();
  const eventBus = modeler.get('eventBus');

  // Wires change on the canvas and here alike - re-derive on any change.
  const [, setRevision] = useState(0);
  useEffect(() => {
    const bump = () => setRevision((r) => r + 1);
    eventBus.on('elements.changed', bump);
    return () => eventBus.off('elements.changed', bump);
  }, [eventBus]);

  const inScope = getPropertiesInScope(element);
  const neighbors: Record<Direction, DataNeighbor[]> = {
    input: getInferredDataNeighbors(element, 'inputs'),
    output: getInferredDataNeighbors(element, 'outputs'),
  };

  // Nothing wired and nothing declarable: this step has no data contract to show.
  if (inScope.length === 0 && neighbors.input.length === 0 && neighbors.output.length === 0) {
    return null;
  }

  const dispatch = (command: any) =>
    executeCommand(modeler, { type: 'update-data-binding', element, ...command });

  const unbound = (direction: Direction) => {
    const wired = new Set(neighbors[direction].filter((n) => n.declared).map((n) => n.name));
    return inScope.filter((property) => !wired.has(property.name));
  };

  const row = (direction: Direction, neighbor: DataNeighbor) => {
    // A drawn element is edited on the canvas; only show what it binds to.
    if (!neighbor.declared || !neighbor.associationId) {
      const label = neighbor.binding ? `${neighbor.name} → ${neighbor.binding}` : neighbor.name;
      return (
        <div key={`${direction}-${neighbor.name}`} className={s.dataFlowRow}>
          <span
            className={s.dataFlowValue}
            title={neighbor.outerScope
              ? `${label} — declared in ${neighbor.outerScope}, so this wire is not drawn on this canvas`
              : label}
          >
            {label}
          </span>
          <span className={s.dataFlowTag}>
            {neighbor.outerScope ? `${neighbor.kind} in ${neighbor.outerScope}` : neighbor.kind}
          </span>
        </div>
      );
    }

    const associationId = neighbor.associationId;
    return (
      <div key={associationId} className={s.stateRow}>
        <span className={s.dataFlowFixed} title={neighbor.name}>{neighbor.name}</span>
        <Input
          aria-label={`${direction === 'input' ? 'Parameter' : 'Transformation'} for ${neighbor.name}`}
          type="text"
          placeholder={direction === 'input' ? 'parameter' : 'result…'}
          value={neighbor.binding ?? ''}
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            dispatch({ action: 'set-binding', direction, associationId, value: e.target.value })}
          className={s.dataFlowBindInput}
        />
        <span className={s.dataFlowTag}>{neighbor.kind}</span>
        <button
          type="button"
          aria-label={`Unbind ${neighbor.name}`}
          onClick={() => dispatch({ action: 'unbind', direction, associationId })}
          className={s.stateRemoveBtn}
        >
          <i className={`${ICONS.closeSmall} text-sm`} />
        </button>
      </div>
    );
  };

  const group = (direction: Direction, label: string) => {
    const available = unbound(direction);
    return (
      <div className={s.dataFlowGroup}>
        <div className={s.dataFlowGroupHead}>
          <span>{label}</span>
          {available.length > 0 && (
            <Listbox
              value=""
              onChange={(propertyId: string) => dispatch({ action: 'bind', direction, propertyId })}
            >
              <ListboxButton
                data-testid={`bind-${direction}`}
                aria-label={`Add ${direction} association`}
                className={s.dataFlowAddBtn}
              >
                <i className={`${ICONS.plus} text-base`} />
              </ListboxButton>
              <ListboxOptions anchor="bottom end" className={s.listboxOptions}>
                {/* The study scope is the default home for a property, so
                    naming it on every option is noise; an intermediate scope
                    is worth calling out, because it bounds the lifetime. */}
                {available.map((property) => (
                  <ListboxOption key={property.id} value={property.id} className={s.comboOption}>
                    {property.own || property.ownerIsRoot
                      ? property.name
                      : `${property.name} — ${property.ownerLabel}`}
                  </ListboxOption>
                ))}
              </ListboxOptions>
            </Listbox>
          )}
        </div>
        <div className={s.arrayList}>{neighbors[direction].map((n) => row(direction, n))}</div>
      </div>
    );
  };

  return (
    <div className={s.field}>
      <div className={s.label}>
        Data associations
        <HelpTooltip name="bpmn:DataAssociation" description={DESCRIPTION} />
      </div>
      <div data-testid="data-flow-section">
        {group('input', 'inputs')}
        {group('output', 'outputs')}
      </div>
    </div>
  );
}
