/** The inputs and outputs sections: an activity's data associations and their bindings. Pure helpers in `dataNeighbors.ts`. */
import { Listbox, ListboxButton, ListboxOption, ListboxOptions, Textarea } from '@headlessui/react';
import { useEffect, useState, type ChangeEvent } from 'react';
import { ICONS } from '@modeler/icons';
import { executeCommand } from '@modeler/commandBus';
import { useModeler } from '@modeler/app/useModeler';
import { useInspectedElement } from '@modeler/inspector/hooks';
import { HelpTooltip } from '@modeler/inspector/widgets';
import { getInferredDataNeighbors, supportsDataAssociations, type DataNeighbor } from '@modeler/inspector/dataNeighbors';
import { getPropertiesInScope } from '@modeler/inspector/stateProperties';
import { field as s } from '@modeler/inspector/styles';

const INPUT_DESCRIPTION =
  'What this step reads: each row gives the slot on the left the element on the '
  + 'right (`X = folds[\'train\']`), and + adds one.';

const OUTPUT_DESCRIPTION =
  'Where this step\'s return value lands: each row gives the element on the left a '
  + 'selection over `result` (blank lands the whole value), and + adds one.';

type Direction = 'input' | 'output';

export function DataFlowSection({ direction }: { direction: Direction }) {
  const element = useInspectedElement();
  const modeler = useModeler();

  const [, setRevision] = useState(0);
  useEffect(() => {
    const bump = () => setRevision((r) => r + 1);
    modeler.events.on('ElementsChanged', bump);
    return () => modeler.events.off('ElementsChanged', bump);
  }, [modeler]);

  const inScope = getPropertiesInScope(element);
  const neighbors: Record<Direction, DataNeighbor[]> = {
    input: getInferredDataNeighbors(element, 'inputs'),
    output: getInferredDataNeighbors(element, 'outputs'),
  };
  const supported: Record<Direction, boolean> = {
    input: supportsDataAssociations(element, 'inputs'),
    output: supportsDataAssociations(element, 'outputs'),
  };

  if (!supported[direction]) return null;
  if (neighbors[direction].length === 0 && inScope.length === 0) return null;

  const dispatch = (command: any) =>
    executeCommand(modeler, { type: 'UpdateDataBinding', element, ...command });

  const unbound = (direction: Direction) => {
    const associated = new Set(neighbors[direction].filter((n) => n.declared).map((n) => n.name));
    return inScope.filter((property) => !associated.has(property.name));
  };

  const row = (direction: Direction, neighbor: DataNeighbor) => {
    if (!neighbor.declared || !neighbor.associationId) {
      const label = !neighbor.binding
        ? neighbor.name
        : direction === 'output'
          ? `${neighbor.name} = ${neighbor.binding}`
          : `${neighbor.binding} = ${neighbor.name}`;
      return (
        <div key={`${direction}-${neighbor.name}`} className={s.dataFlowScoped}>
          <div className={s.dataFlowRow}>
            <span className={s.dataFlowValue} title={`${label} (${neighbor.kind})`}>{label}</span>
          </div>
          {neighbor.outerScope && (
            <span
              className={s.dataFlowScope}
              title={`Declared in ${neighbor.outerScope}, which is drawn on its own canvas.`}
            >
              in {neighbor.outerScope}
            </span>
          )}
        </div>
      );
    }

    const associationId = neighbor.associationId;
    const name = (
      <span className={s.dataFlowFixed} title={`${neighbor.name} (${neighbor.kind})`}>{neighbor.name}</span>
    );
    const equals = (
      <span className={s.dataFlowEquals} aria-hidden="true">=</span>
    );
    const binding = (
      // A textarea rather than an input, because an input cannot wrap a long expression.
      <Textarea
        aria-label={`Transformation for ${neighbor.name}`}
        rows={1}
        placeholder={direction === 'input' ? neighbor.name : 'result'}
        value={neighbor.binding ?? ''}
        onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
        onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
          dispatch({
            action: 'set-binding', direction, associationId,
            value: e.target.value.replace(/\s*\n\s*/g, ' '),
          })}
        className={s.dataFlowBindInput}
      />
    );
    return (
      <div key={associationId} className={s.stateRow}>
        {direction === 'output' ? <>{name}{equals}{binding}</> : <>{binding}{equals}{name}</>}
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

  const group = (label: string, description: string) => {
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
                  className={s.labelAddBtn}
                >
                  <i className={`${ICONS.plus} text-base`} />
                </ListboxButton>
                <ListboxOptions anchor="bottom end" className={s.labelMenuOptions}>
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
    <div data-testid={`data-flow-${direction}s`}>
      {direction === 'input'
        ? group('Inputs', INPUT_DESCRIPTION)
        : group('Outputs', OUTPUT_DESCRIPTION)}
    </div>
  );
}
