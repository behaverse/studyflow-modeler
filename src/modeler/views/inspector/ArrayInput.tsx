import { Input, Label } from '@headlessui/react';
import { useEffect, useRef, type ChangeEvent } from 'react';
import { t } from '@/i18n';
import { HelpTooltip } from '@/modeler/views/inspector/HelpTooltip';
import { useAttributeState } from '@/modeler/views/inspector/hooks/useAttributeState';
import { field as s } from '@/modeler/infra/styles';
import { ICONS } from '@/icons';
import { toArray } from '@/modeler/models/inspector/arrayValue';

type Props = {
  attrDef: any;
};

export function ArrayInput({ attrDef }: Props) {
  const fullName = attrDef.ns?.name ?? attrDef.name;

  const { value: values, commit: persist } = useAttributeState<string[]>(attrDef, toArray);
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const focusIndexRef = useRef<number | null>(null);

  useEffect(() => {
    if (focusIndexRef.current != null) {
      inputRefs.current[focusIndexRef.current]?.focus();
      focusIndexRef.current = null;
    }
  }, [values]);

  function handleChangeAt(index: number, event: ChangeEvent<HTMLInputElement>) {
    const next = values.slice();
    next[index] = event.target.value;
    persist(next);
  }

  function handleRemoveAt(index: number) {
    const next = values.slice();
    next.splice(index, 1);
    persist(next);
  }

  function handleAdd() {
    focusIndexRef.current = values.length;
    persist([...values, '']);
  }

  return (
    <>
      <Label className={s.label}>
        {t(fullName)}
        <HelpTooltip name={fullName} description={attrDef?.description} />
      </Label>

      <div className={s.arrayList}>
        {values.map((value, i) => (
          <div key={i} className={s.arrayRow}>
            <Input
              ref={(el: HTMLInputElement | null) => { inputRefs.current[i] = el; }}
              name={`${fullName}[${i}]`}
              type="text"
              value={value}
              onChange={(e) => handleChangeAt(i, e)}
              className={s.arrayInput}
            />
            <button
              type="button"
              aria-label="Remove"
              onClick={() => handleRemoveAt(i)}
              className={s.arrayRemoveBtn}
            >
              <i className={`${ICONS.closeSmall} text-lg`} />
            </button>
          </div>
        ))}

        <button
          type="button"
          aria-label="Add another item"
          title="Add another item"
          onClick={handleAdd}
          className={s.arrayAddBtn}
        >
          <i className={`${ICONS.plus} text-lg`} />
        </button>
      </div>
    </>
  );
}
