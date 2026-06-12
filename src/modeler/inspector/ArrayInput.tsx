import { Input, Label } from '@headlessui/react';
import { useEffect, useRef, type ChangeEvent } from 'react';
import { t } from '../../i18n';
import { HelpTooltip } from './HelpTooltip';
import { useAttributeState } from './hooks/useAttributeState';
import { useInspectedElement } from './hooks/useInspectedElement';
import { field as s } from '../styles';
import { getInferredDataNeighbors } from './dataNeighbors';

type Props = {
  attrDef: any;
};

function toArray(raw: any): string[] {
  if (Array.isArray(raw)) return raw.map((item) => (item == null ? '' : String(item)));
  if (raw == null || raw === '') return [];
  return [String(raw)];
}

function inferDirection(localName: string): 'inputs' | 'outputs' | undefined {
  if (localName === 'inputs') return 'inputs';
  if (localName === 'outputs') return 'outputs';
  return undefined;
}

export function ArrayInput({ attrDef }: Props) {
  const element = useInspectedElement();
  const fullName = attrDef.ns?.name ?? attrDef.name;
  const localName = attrDef.ns?.localName ?? fullName;

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

  const direction = inferDirection(localName);
  const inferred = direction ? getInferredDataNeighbors(element, direction) : [];
  const showInferred = inferred.length > 0;
  // inputs/outputs are inferred from connected data elements (plus the
  // function's arguments); only free-form lists get a manual add button.
  const allowAdd = !direction;

  return (
    <>
      <Label className={s.label}>
        {t(fullName)}
        <HelpTooltip name={fullName} description={attrDef?.description} />
      </Label>

      <div className={s.arrayList}>
        {showInferred && inferred.map((name) => (
          <div key={name} className={s.arrayRow}>
            <input
              readOnly
              value={name}
              className={s.arrayInferredInput}
            />
            <span className={s.arrayInferredLabel}>Inferred</span>
          </div>
        ))}

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
              <i className="iconify bi--x text-lg" />
            </button>
          </div>
        ))}

        {allowAdd && (
          <button
            type="button"
            aria-label="Add another item"
            title="Add another item"
            onClick={handleAdd}
            className={s.arrayAddBtn}
          >
            <i className="iconify bi--plus text-lg" />
          </button>
        )}
      </div>
    </>
  );
}
