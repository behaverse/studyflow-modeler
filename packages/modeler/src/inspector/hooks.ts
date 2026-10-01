import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { AttributeSpec } from '@core/notation';
import type { Element, StudyModel } from '@core/model/index';
import { readAttribute } from '@core/model/index';
import { useModeler } from '@modeler/app/useModeler';
import { executeCommand } from '@modeler/commandBus';

export const InspectorContext = createContext<{ element: Element | undefined; model: StudyModel | undefined }>({
  element: undefined,
  model: undefined,
});

/** The element the inspector shows, as the study holds it now. */
export function useInspectedElement(): any | undefined {
  return useContext(InspectorContext).element;
}

/** The study model the inspected element is in. */
export function useInspectedModel(): StudyModel {
  return useContext(InspectorContext).model!;
}

/** Debounce batches a typing burst into one write, one undo step; the cleanup flush keeps a selection change from swallowing the tail. */
export function useAttributeState<T>(
  attrDef: AttributeSpec,
  parse: (raw: any) => T,
  options?: { debounceMs?: number },
) {
  const element = useInspectedElement();
  const model = useInspectedModel();
  const modeler = useModeler();
  const attributeName = attrDef.ns?.name ?? attrDef.name;
  const debounceMs = options?.debounceMs ?? 0;

  const modelValue = parse(readAttribute(model, element, attributeName));

  const pendingRef = useRef<{ element: any; attributeName: string; value: T } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [draft, setDraft] = useState<{ element: any; attributeName: string; value: T } | null>(null);

  const dispatch = (target: { element: any; attributeName: string; value: T }) => {
    executeCommand(modeler, {
      type: 'UpdateAttribute',
      element: target.element,
      attributeName: target.attributeName,
      value: target.value,
    });
  };

  const flush = () => {
    clearTimeout(timerRef.current);
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending) dispatch(pending);
    setDraft(null);
  };

  const commit = (next: T) => {
    if (debounceMs <= 0) {
      dispatch({ element, attributeName, value: next });
      return;
    }
    const target = { element, attributeName, value: next };
    pendingRef.current = target;
    setDraft(target);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flush, debounceMs);
  };

  useEffect(() => flush, [element, attributeName]); // eslint-disable-line react-hooks/exhaustive-deps

  const value = draft && draft.element === element && draft.attributeName === attributeName
    ? draft.value
    : modelValue;

  return { value, commit, flush, attributeName, element, modeler };
}
