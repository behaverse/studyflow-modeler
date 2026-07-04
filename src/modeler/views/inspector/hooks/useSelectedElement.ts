import { useEffect, useReducer, useRef, useState } from 'react';

/** Canvas selection (or root if 0/many selected); re-renders on in-place `element.changed`. */
export function useSelectedElement(modeler: any): any {
  const eventBus = modeler.get('eventBus');
  const canvas = modeler.get('canvas');

  const [element, setElement] = useState<any>(null);
  const [, bumpVersion] = useReducer((version) => version + 1, 0);
  const elementRef = useRef<any>(null);

  const setCurrent = (el: any) => {
    setElement(el);
    elementRef.current = el;
  };

  useEffect(() => {
    setCurrent(canvas.getRootElement());

    const onRootSet = () => setCurrent(canvas.getRootElement());
    const onSelectionChanged = (e: any) => {
      const selection = e.newSelection ?? [];
      setCurrent(selection.length === 1 ? selection[0] : canvas.getRootElement());
    };
    const onElementChanged = (e: any) => {
      if (elementRef.current && e.element?.id === elementRef.current.id) bumpVersion();
    };

    eventBus.on('selection.changed', onSelectionChanged);
    eventBus.on('root.set', onRootSet);
    eventBus.on('element.changed', onElementChanged);

    return () => {
      eventBus.off('selection.changed', onSelectionChanged);
      eventBus.off('root.set', onRootSet);
      eventBus.off('element.changed', onElementChanged);
    };
  }, [canvas, eventBus]);

  return element;
}
