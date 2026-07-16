import { Input, Label } from '@headlessui/react';
import { t } from '@/i18n';
import { HelpTooltip } from '@/modeler/views/inspector/HelpTooltip';
import { useAttributeState } from '@/modeler/views/inspector/hooks/useAttributeState';
import { field as s } from '@/modeler/infra/styles';

/** Engine-written attribute (`meta.readonly`): shown for inspection on the
 *  as-run record, never editable - so run state is not changed by mistake. */
export function ReadonlyInput({ attrDef }: { attrDef: any }) {
  const { value } = useAttributeState<string>(attrDef, (raw) => (raw == null ? '' : String(raw)));
  const name = attrDef.ns.name;

  return (
    <>
      <Label className={s.label}>
        {t(name)}
        <HelpTooltip name={name} description={attrDef?.description} />
      </Label>
      <Input
        name={name}
        type="text"
        value={value}
        readOnly
        disabled
        placeholder="written at run time"
        className={s.textInput}
      />
    </>
  );
}
