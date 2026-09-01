import {
  Checkbox,
  Combobox,
  ComboboxButton,
  ComboboxInput,
  ComboboxOption,
  ComboboxOptions,
  Field,
  Input,
  Label,
  Listbox,
  ListboxButton,
  ListboxOption,
  ListboxOptions,
  Textarea,
} from '@headlessui/react';
import { useEffect, useState, type ChangeEvent } from 'react';
import { t } from '@modeler/i18n';
import { ICONS } from '@modeler/icons';
import { readChoreographyBands } from '@core/document';
import { getAttributeSpec } from '@core/element';
import { executeCommand } from '@modeler/commandBus';
import { useRequiredModeler } from '@modeler/app/useModeler';
import { useInspectedElement } from '@modeler/inspector/state';
import { CheckIcon, HelpTooltip } from '@modeler/inspector/widgets';
import { ExpressionRow } from '@modeler/inspector/inputs';
import {
  getInferredDataNeighbors,
  supportsDataAssociations,
  type DataNeighbor,
} from '@modeler/inspector/dataNeighbors';
import {
  getLoopCharacteristics,
  LOOP_STATE_BY_KIND,
  loopKindOf,
  supportsLoopCharacteristics,
  type LoopKind,
} from '@modeler/inspector/loopCharacteristics';
import {
  getPropertiesInScope,
  getStateProperties,
  isScopeContainer,
  itemTypeOptions,
} from '@modeler/inspector/stateProperties';
import { field as s } from '@modeler/inspector/styles';

const TOP_HELP = 'Who takes the top band';
const BOTTOM_HELP = 'Who takes the bottom band';
const INITIATOR_HELP = 'Which participant starts the interaction; its band is drawn light, the other shaded.';

export function ChoreographyParticipantsSection({ element }: { element: any }) {
  const businessObject = element?.businessObject ?? element;
  if (businessObject?.$type !== 'bpmn:ChoreographyTask') return null;
  return <ParticipantFields key={businessObject.id} element={element} />;
}

function ParticipantFields({ element }: { element: any }) {
  const modeler = useRequiredModeler();
  const bands = readChoreographyBands(element.businessObject ?? element);
  const { top, bottom } = bands;

  const commitBand = (field: 'top' | 'bottom', value: string) =>
    executeCommand(modeler, { type: 'UpdateChoreographyParticipants', element, field, value });

  const commitInitiator = (value: 'top' | 'bottom') =>
    executeCommand(modeler, { type: 'UpdateChoreographyParticipants', element, field: 'initiator', value });

  return (
    <>
      <Field className={s.field}>
        <Label className={s.label}>
          Top participant
          <HelpTooltip name="participantRef" description={TOP_HELP} />
        </Label>
        <Input
          type="text"
          name="choreography:top"
          value={top}
          onChange={(e) => commitBand('top', e.target.value)}
          className={s.textInput}
        />
      </Field>
      <Field className={s.field}>
        <Label className={s.label}>
          Bottom participant
          <HelpTooltip name="participantRef" description={BOTTOM_HELP} />
        </Label>
        <Input
          type="text"
          name="choreography:bottom"
          value={bottom}
          onChange={(e) => commitBand('bottom', e.target.value)}
          className={s.textInput}
        />
      </Field>
      <Field className={s.field}>
        <Label className={s.label}>
          Initiating participant
          <HelpTooltip name="initiatingParticipantRef" description={INITIATOR_HELP} />
        </Label>
        <div className={s.selectWrapper}>
          <Listbox value={bands.initiator} onChange={commitInitiator}>
            <ListboxButton aria-label="Initiating participant" className={s.listboxBtn}>
              {bands.initiator === 'top' ? top : bottom}
            </ListboxButton>
            <span className={s.comboChevronIndicator} aria-hidden="true">
              <i className={s.comboChevronIcon}></i>
            </span>
            <ListboxOptions anchor="bottom start" className={s.listboxOptions}>
              <ListboxOption value="top" className={s.comboOption}>{top}</ListboxOption>
              <ListboxOption value="bottom" className={s.comboOption}>{bottom}</ListboxOption>
            </ListboxOptions>
          </Listbox>
        </div>
      </Field>
    </>
  );
}

const SCOPE_DESCRIPTION =
  'This element opens a scope and values declared here live for one instance of it';

export function StateSection() {
  const element = useInspectedElement();
  const modeler = useRequiredModeler();

  if (!isScopeContainer(element)) return null;

  const properties = getStateProperties(element);
  const types = itemTypeOptions(element);

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

const KIND_OPTIONS: LoopKind[] = ['none', 'loop', 'parallel', 'sequential'];

const KIND_DESCRIPTION =
  'How this activity repeats: a conditional loop, parallel, or sequential.';

const LOOP_MAXIMUM_DESCRIPTION =
  'Maximum iterations — always set one, so the loop is guaranteed to end.';

const TEST_BEFORE_DESCRIPTION =
  'Evaluate the loop condition before each iteration (while-do) instead of after it (do-while).';

function expressionText(value: any): string {
  if (typeof value === 'string') return value;
  return value?.body ?? '';
}

export function LoopSection() {
  const element = useInspectedElement();
  const modeler = useRequiredModeler();

  const loopCharacteristics = getLoopCharacteristics(element);
  const kind = loopKindOf(element);

  if (!supportsLoopCharacteristics(element)) return null;

  const setKind = (next: LoopKind) => {
    if (next === kind) return;
    const state = next === 'none' ? null : LOOP_STATE_BY_KIND[next];
    executeCommand(modeler, {
      type: 'UpdateLoopCharacteristics',
      element,
      loopType: state?.loopType ?? null,
      properties: state?.properties,
    });
  };

  const setField = (name: string, value: any) => {
    executeCommand(modeler, {
      type: 'UpdateLoopCharacteristics',
      element,
      loopType: loopCharacteristics.$type,
      properties: { [name]: value },
    });
  };

  const commitLoopMaximum = (raw: string) => {
    if (raw.trim() === '') return setField('loopMaximum', undefined);
    const parsed = Number.parseInt(raw, 10);
    if (Number.isFinite(parsed)) setField('loopMaximum', parsed);
  };

  const conditionDef = loopCharacteristics
    ? getAttributeSpec(loopCharacteristics, 'loopCondition')
    : undefined;

  return (
    <div data-testid="loop-section">
      <Field className={s.field}>
        <Label className={s.label}>
          {t('loopKind')}
          <HelpTooltip name="loopCharacteristics" description={KIND_DESCRIPTION} />
        </Label>
        <div className={s.selectWrapper}>
          <Listbox value={kind} onChange={setKind}>
            <ListboxButton
              data-testid="loop-kind"
              aria-label={t('loopKind')}
              className={s.listboxBtn}
            >
              {t(`loopKind-${kind}`)}
            </ListboxButton>
            <span className={s.comboChevronIndicator} aria-hidden="true">
              <i className={s.comboChevronIcon}></i>
            </span>
            <ListboxOptions anchor="bottom start" className={s.listboxOptions}>
              {KIND_OPTIONS.map((option) => (
                <ListboxOption key={option} value={option} className={s.comboOption}>
                  {t(`loopKind-${option}`)}
                </ListboxOption>
              ))}
            </ListboxOptions>
          </Listbox>
        </div>
      </Field>

      {kind === 'loop' && (
        <>
          <Field className={s.field}>
            <Label className={s.label}>
              {t('loopCondition')}
              <HelpTooltip name="loopCondition" description={conditionDef?.description} />
            </Label>
            <ExpressionRow
              name="loopCondition"
              placeholder="score < 0.9"
              value={expressionText(loopCharacteristics.get('loopCondition'))}
              language={loopCharacteristics.get('loopCondition')?.get?.('language') ?? ''}
              onCommit={(next) => setField('loopCondition', next)}
              onCommitLanguage={(next) => {
                const expression = loopCharacteristics.get('loopCondition');
                if (expression) {
                  executeCommand(modeler, {
                    type: 'UpdateExpressionLanguage', element,
                    attributeName: 'bpmn:loopCondition', language: next,
                  });
                }
              }}
            />
          </Field>
          <Field className={s.field}>
            <Label className={s.label}>
              {t('loopMaximum')}
              <HelpTooltip name="loopMaximum" description={LOOP_MAXIMUM_DESCRIPTION} />
            </Label>
            <Input
              name="loopMaximum"
              type="number"
              min={1}
              step={1}
              value={loopCharacteristics.get('loopMaximum') ?? ''}
              onChange={(e: ChangeEvent<HTMLInputElement>) => commitLoopMaximum(e.target.value)}
              className={s.textInput}
            />
          </Field>
          <Field className={s.field}>
            <div className={s.booleanRow}>
              <span className={s.booleanGroup}>
                <Checkbox
                  name="testBefore"
                  checked={loopCharacteristics.get('testBefore') === true}
                  onChange={(checked: boolean) => setField('testBefore', checked)}
                  className={s.checkbox}
                >
                  <CheckIcon />
                </Checkbox>
                <Label className={s.label}>{t('testBefore')}</Label>
              </span>
              <HelpTooltip name="testBefore" description={TEST_BEFORE_DESCRIPTION} wide={false} />
            </div>
          </Field>
        </>
      )}
    </div>
  );
}

const INPUT_DESCRIPTION =
  'What this step reads: each row gives the slot on the left the element on the '
  + 'right (`X = folds[\'train\']`), and + adds one.';

const OUTPUT_DESCRIPTION =
  'Where this step\'s return value lands: each row gives the element on the left a '
  + 'selection over `result` (blank lands the whole value), and + adds one.';

type Direction = 'input' | 'output';

export function DataFlowSection({ direction }: { direction: Direction }) {
  const element = useInspectedElement();
  const modeler = useRequiredModeler();

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
