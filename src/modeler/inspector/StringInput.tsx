import { Input, Label, Textarea } from '@headlessui/react';
import type { ChangeEvent } from 'react';
import { t } from '../../i18n';
import { HelpTooltip } from './HelpTooltip';
import { useAttributeState } from './hooks/useAttributeState';
import { field as s } from '../styles';

type Props = {
  attrDef: any;
  isMarkdown?: boolean;
};

export function StringInput({ attrDef, isMarkdown }: Props) {
  const { value, commit } = useAttributeState<string>(attrDef, (raw) => raw || '');
  const name = attrDef.ns.name;

  function handleChange(e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    commit(e.target.value);
  }

  return (
    <>
      <Label className={s.label}>
        {t(name)}
        <HelpTooltip name={name} description={attrDef?.description} />
      </Label>
      {isMarkdown ? (
        <Textarea name={name} onChange={handleChange} value={value} rows={4} className={s.textArea} />
      ) : (
        <Input name={name} type="text" onChange={handleChange} value={value} className={s.textInput} />
      )}
    </>
  );
}
