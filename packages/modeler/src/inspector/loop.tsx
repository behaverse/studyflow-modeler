/** The loop section: an activity's `loopCharacteristics`. Pure helpers in `loopCharacteristics.ts`. */
import { Checkbox, Field, Input, Label, Listbox, ListboxButton, ListboxOption, ListboxOptions } from '@headlessui/react';
import type { ChangeEvent } from 'react';
import { t } from '@modeler/i18n';
import { getAttributeSpec } from '@core/element';
import { executeCommand } from '@modeler/commandBus';
import { useModeler } from '@modeler/app/useModeler';
import { useInspectedElement } from '@modeler/inspector/hooks';
import { CheckIcon, HelpTooltip } from '@modeler/inspector/widgets';
import { ExpressionRow } from '@modeler/inspector/inputs';
import {
  getLoopCharacteristics,
  LOOP_STATE_BY_KIND,
  loopKindOf,
  supportsLoopCharacteristics,
  type LoopKind,
} from '@modeler/inspector/loopCharacteristics';
import { field as s } from '@modeler/inspector/styles';

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
  const modeler = useModeler();

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
