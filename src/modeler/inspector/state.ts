import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { AttributeSpec } from '@behaverse/studyflow-core/notation';
import { getAttribute } from '@behaverse/studyflow-core/element';
import { useRequiredModeler } from '@/modeler/app/useModeler';
import { executeCommand } from '@/modeler/commandBus';

export const InspectorContext = createContext<{ element: any | undefined }>({
  element: undefined,
});

export function useInspectedElement(): any | undefined {
  return useContext(InspectorContext).element;
}

/** Debounce batches a typing burst into one write — one undo step; the cleanup flush keeps a selection change from swallowing the tail. */
export function useAttributeState<T>(
  attrDef: AttributeSpec,
  parse: (raw: any) => T,
  options?: { debounceMs?: number },
) {
  const element = useInspectedElement();
  const modeler = useRequiredModeler();
  const attributeName = attrDef.ns?.name ?? attrDef.name;
  const debounceMs = options?.debounceMs ?? 0;

  const modelValue = parse(getAttribute(element, attributeName));

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
