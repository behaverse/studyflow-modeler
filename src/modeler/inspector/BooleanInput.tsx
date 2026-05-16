import { Checkbox, Label } from '@headlessui/react';
import { t } from '../../i18n';
import { CheckIcon } from './CheckIcon';
import { HelpTooltip } from './HelpTooltip';
import { useAttributeState } from './hooks/useAttributeState';
import { field as s } from '../styles';

export function BooleanInput({ attrDef }: { attrDef: any }) {
  const { value, commit } = useAttributeState<boolean>(attrDef, (raw) => !!raw);
  const name = attrDef.ns.name;

  return (
    <div className={s.booleanRow}>
      <span className={s.booleanGroup}>
        <Checkbox checked={value} onChange={commit} className={s.checkbox}>
          <CheckIcon />
        </Checkbox>
        <Label className={s.label}>{t(name)}</Label>
      </span>
      <HelpTooltip name={name} description={attrDef?.description} wide={false} />
    </div>
  );
}
