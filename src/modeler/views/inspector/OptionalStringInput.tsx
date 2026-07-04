import { Checkbox, Input, Label } from '@headlessui/react';
import type { ChangeEvent } from 'react';
import { t } from '@/i18n';
import { CheckIcon } from '@/modeler/views/inspector/CheckIcon';
import { HelpTooltip } from '@/modeler/views/inspector/HelpTooltip';
import { useAttributeState } from '@/modeler/views/inspector/hooks/useAttributeState';
import { field as s } from '@/modeler/infra/styles';

export function OptionalStringInput({ attrDef }: { attrDef: any }) {
  const { value, commit } = useAttributeState<string | undefined>(
    attrDef,
    (raw) => (raw == null ? undefined : String(raw)),
  );
  const name = attrDef.ns.name;
  const isSet = value !== undefined;

  function handleToggle(checked: boolean) {
    commit(checked ? '' : undefined);
  }

  function handleTextChange(e: ChangeEvent<HTMLInputElement>) {
    commit(e.target.value);
  }

  return (
    <>
      <div className={s.booleanRow}>
        <span className={s.booleanGroup}>
          <Checkbox checked={isSet} onChange={handleToggle} className={s.checkbox}>
            <CheckIcon />
          </Checkbox>
          <Label className={s.label}>{t(name)}</Label>
        </span>
        <HelpTooltip name={name} description={attrDef?.description} />
      </div>
      {isSet && (
        <Input
          name={name}
          type="text"
          onChange={handleTextChange}
          value={value ?? ''}
          className={s.textInput}
        />
      )}
    </>
  );
}
