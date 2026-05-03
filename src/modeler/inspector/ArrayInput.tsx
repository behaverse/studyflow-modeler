import { Input, Label } from '@headlessui/react';
import { useContext, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { ModelerContext, InspectorContext } from '../contexts';
import { t } from '../../i18n';
import { getProperty } from '../extensions';
import { executeCommand } from '../commands';
import { field as s } from '../styles';
import { getInferredDataNeighbors } from './dataNeighbors';

type Props = {
  bpmnProperty: any;
};

function toArray(raw: any): string[] {
  if (Array.isArray(raw)) return raw.map((v) => (v == null ? '' : String(v)));
  if (raw == null || raw === '') return [];
  return [String(raw)];
}

function inferDirection(localName: string): 'inputs' | 'outputs' | undefined {
  if (localName === 'inputs') return 'inputs';
  if (localName === 'outputs') return 'outputs';
  return undefined;
}

export function ArrayInput({ bpmnProperty }: Props) {
  const { element } = useContext(InspectorContext);
  const { modeler } = useContext(ModelerContext);

  const fullName = bpmnProperty.ns?.name ?? bpmnProperty.name;
  const localName = bpmnProperty.ns?.localName ?? fullName;

  const [values, setValues] = useState<string[]>(toArray(getProperty(element, fullName)));
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const focusIndexRef = useRef<number | null>(null);

  useEffect(() => {
    setValues(toArray(getProperty(element, fullName)));
  }, [element, fullName]);

  useEffect(() => {
    if (focusIndexRef.current != null) {
      inputRefs.current[focusIndexRef.current]?.focus();
      focusIndexRef.current = null;
    }
  }, [values]);

  function persist(next: string[]) {
    setValues(next);
    executeCommand(modeler, {
      type: 'update-property',
      element,
      propertyName: fullName,
      value: next,
    });
  }

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

  return (
    <>
      <Label className={s.label}>
        {t(fullName)}
        <div className={s.helpAnchor}>
          <i className={s.helpIcon}></i>
          <div className={s.helpTooltipWide}>
            <pre className={s.helpTooltipName}>{fullName}</pre>
            {bpmnProperty?.description}
          </div>
        </div>
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

        {values.map((v, i) => (
          <div key={i} className={s.arrayRow}>
            <Input
              ref={(el: HTMLInputElement | null) => { inputRefs.current[i] = el; }}
              name={`${fullName}[${i}]`}
              type="text"
              value={v}
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

        <button
          type="button"
          aria-label="Add another item"
          title="Add another item"
          onClick={handleAdd}
          className={s.arrayAddBtn}
        >
          <i className="iconify bi--plus text-lg" />
        </button>
      </div>
    </>
  );
}
