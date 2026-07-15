import {
  Checkbox,
  Field,
  Input,
  Label,
  Listbox,
  ListboxButton,
  ListboxOption,
  ListboxOptions,
} from '@headlessui/react';
import type { ChangeEvent } from 'react';
import { t } from '@/i18n';
import { getAttributeDefinition } from '@/core/extensions';
import { executeCommand } from '@/modeler/controllers/commandBus';
import { useModeler } from '@/modeler/views/useModeler';
import { useInspectedElement } from '@/modeler/views/inspector/hooks/useInspectedElement';
import { CheckIcon } from '@/modeler/views/inspector/CheckIcon';
import { HelpTooltip } from '@/modeler/views/inspector/HelpTooltip';
import {
  getLoopCharacteristics,
  LOOP_TYPE_BY_KIND,
  loopKindOf,
  type LoopKind,
} from '@/modeler/models/inspector/loopCharacteristics';
import { field as s } from '@/modeler/infra/styles';

const KIND_OPTIONS: LoopKind[] = ['none', 'standard', 'multi-instance'];

const KIND_DESCRIPTION =
  'How this activity repeats, stored as BPMN\'s own loopCharacteristics child. '
  + 'A standard loop (↻) re-runs the body while its condition holds; '
  + 'a multi-instance (∥ / ≡) runs one instance per item of a collection.';

const LOOP_MAXIMUM_DESCRIPTION =
  'Hard ceiling on iterations. Always set one — it is the only guaranteed termination bound.';

const TEST_BEFORE_DESCRIPTION =
  'Evaluate the loop condition before each iteration (while-do) instead of after it (do-while).';

const IS_SEQUENTIAL_DESCRIPTION =
  'Run the instances one after another (≡) instead of concurrently (∥).';

/**
 * "Loop" tab: edits the activity's `loopCharacteristics` child, which the
 * catalog-driven attribute fields cannot reach (they only resolve attributes
 * on the element and its extension wrapper). Values are read from the model
 * on every render, so undo/redo and external edits stay reflected; writes
 * dispatch `update-loop-characteristics`, one undo step each.
 */
export function LoopSection() {
  const element = useInspectedElement();
  const modeler = useModeler();

  const loopCharacteristics = getLoopCharacteristics(element);
  const kind = loopKindOf(element);

  const setKind = (next: LoopKind) => {
    if (next === kind) return;
    executeCommand(modeler, {
      type: 'update-loop-characteristics',
      element,
      loopType: next === 'none' ? null : LOOP_TYPE_BY_KIND[next],
    });
  };

  const setField = (name: string, value: any) => {
    executeCommand(modeler, {
      type: 'update-loop-characteristics',
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

  // The exec:LoopCondition trait flattens `loopCondition` to a string
  // attribute; reuse its schema description for the tooltip.
  const conditionDef = loopCharacteristics
    ? getAttributeDefinition(loopCharacteristics, 'loopCondition')
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

      {kind === 'standard' && (
        <>
          <Field className={s.field}>
            <Label className={s.label}>
              {t('loopCondition')}
              <HelpTooltip name="loopCondition" description={conditionDef?.description} />
            </Label>
            <Input
              name="loopCondition"
              type="text"
              placeholder="score < 0.9"
              value={loopCharacteristics.get('loopCondition') ?? ''}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setField('loopCondition', e.target.value)}
              className={s.textInput}
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

      {kind === 'multi-instance' && (
        <Field className={s.field}>
          <div className={s.booleanRow}>
            <span className={s.booleanGroup}>
              <Checkbox
                name="isSequential"
                checked={loopCharacteristics.get('isSequential') === true}
                onChange={(checked: boolean) => setField('isSequential', checked)}
                className={s.checkbox}
              >
                <CheckIcon />
              </Checkbox>
              <Label className={s.label}>{t('isSequential')}</Label>
            </span>
            <HelpTooltip name="isSequential" description={IS_SEQUENTIAL_DESCRIPTION} wide={false} />
          </div>
        </Field>
      )}
    </div>
  );
}
