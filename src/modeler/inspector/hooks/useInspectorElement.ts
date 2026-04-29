import { useCallback, useEffect, useRef, useState } from 'react';
import { getCategoriesSignature, getProperties } from '../categories';

type InspectorElementState = {
  /** Currently inspected element (selection, or the root when nothing is selected). */
  element: any;
  /** Current canvas root element. */
  rootElement: any;
};

/**
 * Subscribe to the modeler's selection/root/element lifecycle and expose
 * the element currently shown in the inspector.
 *
 * Re-renders the category bar only when the rendered property-set signature
 * changes, which lets property-value edits fire cheaply without thrashing
 * the tab list above.
 */
export function useInspectorElement(modeler: any): InspectorElementState & { categoryBarVersion: number } {
  const eventBus = modeler.get('injector').get('eventBus');
  const canvas = modeler.get('canvas');

  const [element, setElement] = useState<any>(null);
  const [rootElement, setRootElement] = useState<any>(null);
  const [categoryBarVersion, setCategoryBarVersion] = useState(0);

  const elementRef = useRef<any>(null);
  const rootRef = useRef<any>(null);
  const categorySignatureRef = useRef<string>('');

  const setElementAndRef = useCallback((el: any) => {
    setElement(el);
    elementRef.current = el;
  }, []);

  const setRootAndElement = useCallback((el: any) => {
    setRootElement(el);
    rootRef.current = el;
    setElementAndRef(el);
  }, [setElementAndRef]);

  const syncCategoriesBar = useCallback((el: any, shouldRender: boolean) => {
    if (!el) {
      categorySignatureRef.current = '';
      return;
    }
    const signature = getCategoriesSignature(getProperties(el));
    if (signature === categorySignatureRef.current) return;
    categorySignatureRef.current = signature;
    if (shouldRender) setCategoryBarVersion((v) => v + 1);
  }, []);

  useEffect(() => {
    const initialRoot = canvas.getRootElement();
    setRootAndElement(initialRoot);
    syncCategoriesBar(initialRoot, false);

    function onRootChanged() {
      const newRoot = canvas.getRootElement();
      setRootAndElement(newRoot);
      syncCategoriesBar(newRoot, false);
    }

    function onSelectionChanged(e: any) {
      const selections = e.newSelection;
      const root = rootRef.current || canvas.getRootElement();
      const newElement = selections.length === 1 ? selections[0] : root;
      setElementAndRef(newElement);
      syncCategoriesBar(newElement, false);
    }

    function onElementChanged(e: any) {
      // Refresh the element when properties change (including ID changes).
      if (elementRef.current && e.element && e.element.id === elementRef.current.id) {
        setElementAndRef(e.element);
        syncCategoriesBar(e.element, true);
      }
    }

    eventBus.on('selection.changed', onSelectionChanged);
    eventBus.on('root.set', onRootChanged);
    eventBus.on('element.changed', onElementChanged);

    return () => {
      eventBus.off('selection.changed', onSelectionChanged);
      eventBus.off('root.set', onRootChanged);
      eventBus.off('element.changed', onElementChanged);
    };
  }, [canvas, eventBus, setElementAndRef, setRootAndElement, syncCategoriesBar]);

  return { element, rootElement, categoryBarVersion };
}
