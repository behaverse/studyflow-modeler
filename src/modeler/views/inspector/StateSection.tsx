import {
  Combobox,
  ComboboxButton,
  ComboboxInput,
  ComboboxOption,
  ComboboxOptions,
  Input,
} from '@headlessui/react';
import { useState, type ChangeEvent } from 'react';
import { ICONS } from '@/icons';
import { executeCommand } from '@/modeler/controllers/commandBus';
import { useModeler } from '@/modeler/views/useModeler';
import { useInspectedElement } from '@/modeler/views/inspector/hooks/useInspectedElement';
import { HelpTooltip } from '@/modeler/views/inspector/HelpTooltip';
import {
  getStateProperties,
  isScopeContainer,
  itemTypeOptions,
} from '@/modeler/models/inspector/stateProperties';
import { field as s } from '@/modeler/infra/styles';

/** Which of these leads the tooltip is the one thing about this element's
 *  declarations that its own row cannot show. */
const OPENS_A_SCOPE = 'This element opens a scope: what it declares lives for one instance of it.';
const DECLARED_HERE = 'Declared on this element and read through the scope that contains it.';

const SCOPE_DESCRIPTION =
  'The bpmn:Property children this element declares — BPMN\'s own construct '
  + 'for a value a run carries, typed by a bpmn:ItemDefinition. Unlike a data '
  + 'object, a property is never drawn: it lives in the file, where the '
  + 'runner, a validator, and any BPMN 2.0 tool can read it. What declares one '
  + 'also scopes it: a property on the process is readable from every task and '
  + 'sub-process, one on a sub-process only from inside it, and it is '
  + 'discarded when that sub-process ends. Gateway conditions read these names '
  + 'directly (e.g. `arm == "treatment"`).';

/**
 * Properties, in the Execution tab: edits the element's `bpmn:Property`
 * children, which the
 * catalog-driven fields cannot reach (they resolve attributes on the element
 * and its extension wrapper, not native child collections). Values are read
 * from the model on every render, so undo/redo stays reflected; each write
 * dispatches `update-state-properties`, one undo step per edit.
 */
export function StateSection() {
  const element = useInspectedElement();
  const modeler = useModeler();

  const properties = getStateProperties(element);
  const scoped = isScopeContainer(element);
  const types = itemTypeOptions(element);

  const dispatch = (command: any) =>
    executeCommand(modeler, { type: 'update-state-properties', element, ...command });

  return (
    <div data-testid="state-section">
      {/* Deliberately not a headlessui Field: it would label every control
          inside it "Properties", so each row's own name would be lost. */}
      <div className={s.field}>
        <div className={s.label}>
          Properties
          <span className={s.labelActions}>
            <button
              type="button"
              data-testid="add-property"
              aria-label="Add a property"
              title="Add a property"
              onClick={() => dispatch({ action: 'add' })}
              className={s.dataFlowAddBtn}
            >
              <i className={`${ICONS.plus} text-base`} />
            </button>
            <HelpTooltip
              testId="state-scope-help"
              name="bpmn:Property"
              description={`${scoped ? OPENS_A_SCOPE : DECLARED_HERE} ${SCOPE_DESCRIPTION}`}
            />
          </span>
        </div>

        {properties.length > 0 && (
        <div className={s.arrayList}>
          {properties.map((property) => (
            <div key={property.id} className={s.stateRow}>
              <Input
                name={`property-${property.id}`}
                aria-label={`Property name (${property.id})`}
                type="text"
                placeholder="name"
                value={property.name}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  dispatch({ action: 'rename', propertyId: property.id, name: e.target.value })}
                className={s.stateNameInput}
              />
              <ItemTypeField
                propertyId={property.id}
                value={property.itemType}
                options={types}
                onCommit={(itemType) =>
                  dispatch({ action: 'retype', propertyId: property.id, itemType })}
              />
              <button
                type="button"
                aria-label={`Remove ${property.name || property.id}`}
                onClick={() => dispatch({ action: 'remove', propertyId: property.id })}
                className={s.stateRemoveBtn}
              >
                <i className={`${ICONS.closeSmall} text-sm`} />
              </button>
            </div>
          ))}
        </div>
        )}

      </div>
    </div>
  );
}

type ItemTypeFieldProps = {
  propertyId: string;
  value: string;
  /** Suggestions; any other text is a valid type too. */
  options: string[];
  onCommit: (itemType: string) => void;
};

/**
 * The type half of a property row.
 *
 * A `bpmn:ItemDefinition#structureRef` is free text — `pandas.DataFrame` is as
 * legal as `string` — so this is a combobox, not a fixed list: the built-in
 * scalars and every type the diagram already declares are offered, and
 * anything else can be typed. Blank clears the type.
 */
function ItemTypeField({ propertyId, value, options, onCommit }: ItemTypeFieldProps) {
  const [query, setQuery] = useState('');

  const q = query.trim().toLowerCase();
  const matches = q ? options.filter((type) => type.toLowerCase().includes(q)) : options;
  const isNew = !!q && !options.some((type) => type.toLowerCase() === q);

  const commit = (next: string) => {
    const trimmed = next.trim();
    if (trimmed !== value) onCommit(trimmed);
  };

  return (
    <div className={s.stateTypeField}>
      <Combobox
        immediate
        value={value}
        onChange={(next: string | null) => {
          setQuery('');
          commit(next ?? '');
        }}
        onClose={() => setQuery('')}
      >
        <ComboboxInput
          data-testid={`property-type-${propertyId}`}
          aria-label={`Item type (${propertyId})`}
          placeholder="untyped"
          title={value}
          className={s.stateTypeInput}
          displayValue={(type: string | null) => type ?? ''}
          onChange={(event) => setQuery(event.target.value)}
          onBlur={(event) => commit(event.target.value)}
        />
        <ComboboxButton className={s.stateTypeChevronBtn} aria-label={`Type suggestions (${propertyId})`}>
          <i className={s.stateTypeChevron} aria-hidden="true" />
        </ComboboxButton>
        <ComboboxOptions anchor="bottom end" className={s.stateTypeOptions}>
          {isNew && (
            <ComboboxOption value={query.trim()} className={s.stateTypeOption}>
              <span className={s.stateTypeNew}>Use </span>{query.trim()}
            </ComboboxOption>
          )}
          {!q && (
            <ComboboxOption value="" className={s.stateTypeOption}>
              <span className={s.stateTypeUntyped}>untyped</span>
            </ComboboxOption>
          )}
          {matches.map((type) => (
            <ComboboxOption key={type} value={type} title={type} className={s.stateTypeOption}>
              {type}
            </ComboboxOption>
          ))}
        </ComboboxOptions>
      </Combobox>
    </div>
  );
}
