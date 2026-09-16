/** The state section: the `bpmn:Property` declarations of a scope, each with its item type. Pure helpers in `stateProperties.ts`. */
import { Combobox, ComboboxButton, ComboboxInput, ComboboxOption, ComboboxOptions, Input } from '@headlessui/react';
import { useState, type ChangeEvent } from 'react';
import { ICONS } from '@modeler/icons';
import { wiredProperties } from '@core/document';
import { executeCommand } from '@modeler/commandBus';
import { useModeler } from '@modeler/app/useModeler';
import { useInspectedElement } from '@modeler/inspector/hooks';
import { HelpTooltip } from '@modeler/inspector/widgets';
import { getStateProperties, isScopeContainer, itemTypeOptions } from '@modeler/inspector/stateProperties';
import { field as s } from '@modeler/inspector/styles';

const SCOPE_DESCRIPTION =
  'This element opens a scope and values declared here live for one instance of it';

export function StateSection() {
  const element = useInspectedElement();
  const modeler = useModeler();

  if (!isScopeContainer(element)) return null;

  const properties = getStateProperties(element);
  const types = itemTypeOptions(element);
  // What the Parameters wired into a sub-process set: properties of it like the declared ones, but read-only.
  const wired = wiredProperties(element);

  const dispatch = (command: any) =>
    executeCommand(modeler, { type: 'UpdateStateProperties', element, ...command });

  return (
    <div data-testid="state-section">
      {/* Deliberately not a headlessui Field: it would label every control "Properties", losing each row's own name. */}
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
              className={s.labelAddBtn}
            >
              <i className={`${ICONS.plus} text-base`} />
            </button>
            <HelpTooltip
              testId="state-scope-help"
              name="bpmn:Property"
              description={SCOPE_DESCRIPTION}
            />
          </span>
        </div>

        {properties.length + wired.length > 0 && (
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
          {wired.map(({ name, value, source }) => (
            <div key={`wired:${name}`} data-testid={`wired-property-${name}`}>
              <div className={s.stateLocked}>
                <i className={`${ICONS.lock} text-xs text-stone-500`} aria-hidden="true" />
                {name}
                <span className={s.stateLockedValue}>{typeof value === 'string' ? value : JSON.stringify(value)}</span>
              </div>
              <div className={s.overriddenNote}>
                Set by{' '}
                <button
                  type="button"
                  className={s.overriddenSource}
                  onClick={() => executeCommand(modeler, { type: 'SelectElement', id: source.id })}
                >
                  {source.name || source.id}
                </button>
                ; read-only inside, edit it there.
              </div>
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
  options: string[];
  onCommit: (itemType: string) => void;
};

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
