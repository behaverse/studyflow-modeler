import { Input, Listbox, ListboxButton, ListboxOption, ListboxOptions } from '@headlessui/react';
import { useEffect, useState, type ChangeEvent } from 'react';
import { ICONS } from '@/icons';
import { executeCommand } from '@/modeler/controllers/commandBus';
import { useModeler } from '@/modeler/views/useModeler';
import { HelpTooltip } from '@/modeler/views/inspector/HelpTooltip';
import { useInspectedElement } from '@/modeler/views/inspector/hooks/useInspectedElement';
import {
  getInferredDataNeighbors,
  supportsDataAssociations,
  type DataNeighbor,
} from '@/modeler/models/inspector/dataNeighbors';
import { getPropertiesInScope } from '@/modeler/models/inspector/stateProperties';
import { field as s } from '@/modeler/infra/styles';

/** What both directions share, said once and appended to each. */
const HOW_WIRES_ARE_MADE =
  ' A wire to something drawn on the canvas is made by drawing it, and is '
  + 'read-only here. A property is never drawn, so its wire is made here with '
  + '+, which offers the properties in scope: this element\'s own, then those '
  + 'of each container around it. A row tagged with another container is a '
  + 'wire reaching out of this sub-process — valid BPMN, with its two ends on '
  + 'different planes, so there is no line to look for on the canvas.';

const INPUT_DESCRIPTION =
  'What this step reads. The second box is the callable parameter the value '
  + 'fills; blank binds by the wired element\'s own name.' + HOW_WIRES_ARE_MADE;

const OUTPUT_DESCRIPTION =
  'Where this step\'s return value lands. The second box narrows it — an '
  + 'expression over `result`, BPMN\'s own transformation; blank lands the '
  + 'whole value.' + HOW_WIRES_ARE_MADE;

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
  const supported: Record<Direction, boolean> = {
    input: supportsDataAssociations(element, 'inputs'),
    output: supportsDataAssociations(element, 'outputs'),
  };

  // Nothing wired, nothing declarable, or nowhere for a wire to live: this
  // element has no data contract to show.
  const empty = inScope.length === 0 && neighbors.input.length === 0 && neighbors.output.length === 0;
  if (empty || (!supported.input && !supported.output)) return null;

  const dispatch = (command: any) =>
    executeCommand(modeler, { type: 'update-data-binding', element, ...command });

  const unbound = (direction: Direction) => {
    const wired = new Set(neighbors[direction].filter((n) => n.declared).map((n) => n.name));
    return inScope.filter((property) => !wired.has(property.name));
  };

  const row = (direction: Direction, neighbor: DataNeighbor) => {
    // A drawn element is edited on the canvas; only show what it binds to.
    // Which BPMN kind it is stays in the row's title: the row already shows
    // it — a drawn element reads as a dashed, uneditable pill and a property
    // as an editable field — and spelling it out on every row was the same
    // word four times over.
    if (!neighbor.declared || !neighbor.associationId) {
      const label = neighbor.binding ? `${neighbor.name} → ${neighbor.binding}` : neighbor.name;
      return (
        <div key={`${direction}-${neighbor.name}`} className={s.dataFlowScoped}>
          <div className={s.dataFlowRow}>
            <span className={s.dataFlowValue} title={`${label} (${neighbor.kind})`}>{label}</span>
          </div>
          {neighbor.outerScope && (
            <span
              className={s.dataFlowScope}
              title={`Declared in ${neighbor.outerScope}. BPMN draws that scope on another plane, so this wire has no line on this canvas.`}
            >
              in {neighbor.outerScope}
            </span>
          )}
        </div>
      );
    }

    const associationId = neighbor.associationId;
    return (
      <div key={associationId} className={s.stateRow}>
        <span className={s.dataFlowFixed} title={`${neighbor.name} (${neighbor.kind})`}>{neighbor.name}</span>
        <Input
          aria-label={`${direction === 'input' ? 'Parameter' : 'Transformation'} for ${neighbor.name}`}
          type="text"
          placeholder={direction === 'input' ? 'parameter' : 'result…'}
          value={neighbor.binding ?? ''}
          onChange={(e: ChangeEvent<HTMLInputElement>) =>
            dispatch({ action: 'set-binding', direction, associationId, value: e.target.value })}
          className={s.dataFlowBindInput}
        />
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

  const group = (direction: Direction, label: string, description: string) => {
    if (!supported[direction]) return null;
    const available = unbound(direction);
    return (
      <div className={s.field}>
        <div className={s.label}>
          {label}
          <span className={s.labelActions}>
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
            <HelpTooltip
              name={`bpmn:Data${direction === 'input' ? 'Input' : 'Output'}Association`}
              description={description}
            />
          </span>
        </div>
        {neighbors[direction].length > 0 && (
          <div className={s.arrayList}>{neighbors[direction].map((n) => row(direction, n))}</div>
        )}
      </div>
    );
  };

  return (
    <div data-testid="data-flow-section">
      {group('input', 'Inputs', INPUT_DESCRIPTION)}
      {group('output', 'Outputs', OUTPUT_DESCRIPTION)}
    </div>
  );
}
