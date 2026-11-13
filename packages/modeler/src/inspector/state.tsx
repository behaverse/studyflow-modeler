/** The state sections: the `bpmn:Property` declarations of a scope, the study's `bpmn:DataStore`s, each with its item
 * type, and the store a data store reference shows. Pure helpers in `stateProperties.ts`. */
import { Combobox, ComboboxButton, ComboboxInput, ComboboxOption, ComboboxOptions, Input } from '@headlessui/react';
import { useState, type ChangeEvent } from 'react';
import { ICONS } from '@modeler/icons';
import { wiredPropertiesIn } from '@core/model/parameters';
import { executeCommand } from '@modeler/commandBus';
import { useModeler } from '@modeler/app/useModeler';
import { useInspectedElement, useInspectedModel } from '@modeler/inspector/hooks';
import { HelpTooltip } from '@modeler/inspector/widgets';
import { getDataStores, getStateProperties, isScopeContainer, itemTypeOptions, storeOf } from '@modeler/inspector/stateProperties';
import { field as s } from '@modeler/inspector/styles';

const SCOPE_DESCRIPTION =
  'This element opens a scope and values declared here live for one instance of it';

const STORES_DESCRIPTION =
  'Values the study keeps for all its participants and from run to run; a step reads and writes one through a data store reference';

export function StateSection() {
  const element = useInspectedElement();
  const model = useInspectedModel();
  const modeler = useModeler();

  if (!element || !isScopeContainer(model, element)) return null;

  const properties = getStateProperties(model, element);
  const types = itemTypeOptions(model);
  // The properties that the Parameters wired into a sub-process set: listed like the declared ones, but read-only.
  const wired = wiredPropertiesIn(model, element);

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
                <i className={`${ICONS.close} text-sm`} />
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
                  onClick={() => executeCommand(modeler, { type: 'SelectElement', id: String(source.id) })}
                >
                  {String(source.name || source.id)}
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

/** The study's data stores: on its root, beside the properties of its process. */
export function DataStoresSection() {
  const element = useInspectedElement();
  const model = useInspectedModel();
  const modeler = useModeler();

  if (!element || element.id !== model.primaryRoot()?.id) return null;

  const stores = getDataStores(model);
  const types = itemTypeOptions(model);
  const dispatch = (command: any) =>
    executeCommand(modeler, { type: 'UpdateDataStores', element, ...command });

  return (
    <div data-testid="data-stores-section">
      <div className={s.field}>
        <div className={s.label}>
          Data stores
          <span className={s.labelActions}>
            <button
              type="button"
              data-testid="add-data-store"
              aria-label="Add a data store"
              title="Add a data store"
              onClick={() => dispatch({ action: 'add' })}
              className={s.labelAddBtn}
            >
              <i className={`${ICONS.plus} text-base`} />
            </button>
            <HelpTooltip testId="data-stores-help" name="bpmn:DataStore" description={STORES_DESCRIPTION} />
          </span>
        </div>

        {stores.length > 0 && (
        <div className={s.arrayList}>
          {stores.map((store) => (
            <div key={store.id} className={s.stateRow}>
              <Input
                name={`store-${store.id}`}
                aria-label={`Data store name (${store.id})`}
                type="text"
                placeholder="name"
                value={store.name}
                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                  dispatch({ action: 'rename', storeId: store.id, name: e.target.value })}
                className={s.stateNameInput}
              />
              <ItemTypeField
                testId={`store-type-${store.id}`}
                propertyId={store.id}
                value={store.itemType}
                options={types}
                onCommit={(itemType) => dispatch({ action: 'retype', storeId: store.id, itemType })}
              />
              <button
                type="button"
                aria-label={`Remove ${store.name || store.id}`}
                onClick={() => dispatch({ action: 'remove', storeId: store.id })}
                className={s.stateRemoveBtn}
              >
                <i className={`${ICONS.close} text-sm`} />
              </button>
            </div>
          ))}
        </div>
        )}
      </div>
    </div>
  );
}

/** The data store a reference shows: one the study declares, or a name typed to declare one. */
export function DataStoreReferenceSection() {
  const element = useInspectedElement();
  const model = useInspectedModel();
  const modeler = useModeler();

  if (!element || !model.isA(element, 'bpmn:DataStoreReference')) return null;

  const store = storeOf(model, element);
  const names = getDataStores(model).map((declared) => declared.name || declared.id);

  return (
    <div data-testid="data-store-field" className={s.field}>
      <div className={s.label}>Data store</div>
      <div className={s.stateRow}>
        <SuggestField
          testId="data-store-name"
          label="Data store"
          placeholder="none"
          none="none"
          value={store ? String(store.name || store.id) : ''}
          options={names}
          onCommit={(name) => executeCommand(modeler, { type: 'SetDataStore', element, name })}
          wide
        />
      </div>
    </div>
  );
}

type ItemTypeFieldProps = {
  propertyId: string;
  value: string;
  options: string[];
  onCommit: (itemType: string) => void;
  testId?: string;
};

function ItemTypeField({ propertyId, value, options, onCommit, testId }: ItemTypeFieldProps) {
  return (
    <SuggestField
      testId={testId ?? `property-type-${propertyId}`}
      label={`Item type (${propertyId})`}
      placeholder="untyped"
      none="untyped"
      value={value}
      options={options}
      onCommit={onCommit}
    />
  );
}

type SuggestFieldProps = {
  testId: string;
  label: string;
  placeholder: string;
  /** The label of the empty choice. */
  none: string;
  value: string;
  options: string[];
  onCommit: (next: string) => void;
  /** Fills its row, rather than sitting beside a name. */
  wide?: boolean;
};

/** A text field that suggests `options` and also takes new text. */
function SuggestField({ testId, label, placeholder, none, value, options, onCommit, wide }: SuggestFieldProps) {
  const [query, setQuery] = useState('');

  const q = query.trim().toLowerCase();
  const matches = q ? options.filter((type) => type.toLowerCase().includes(q)) : options;
  const isNew = !!q && !options.some((type) => type.toLowerCase() === q);

  const commit = (next: string) => {
    const trimmed = next.trim();
    if (trimmed !== value) onCommit(trimmed);
  };

  return (
    <div className={wide ? s.stateSuggestWide : s.stateTypeField}>
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
          data-testid={testId}
          aria-label={label}
          placeholder={placeholder}
          title={value}
          className={s.stateTypeInput}
          displayValue={(type: string | null) => type ?? ''}
          onChange={(event) => setQuery(event.target.value)}
          onBlur={(event) => commit(event.target.value)}
        />
        <ComboboxButton className={s.stateTypeChevronBtn} aria-label={`Suggestions (${label})`}>
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
              <span className={s.stateTypeUntyped}>{none}</span>
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
