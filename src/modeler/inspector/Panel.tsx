import { useContext, useEffect, useState } from 'react';
import { getBusinessObject } from 'bpmn-js/lib/util/ModelUtil';
import { ModelerContext, InspectorContext } from '../contexts';
import { ToggleButton } from './ToggleButton';
import { Header } from './Header';
import { CategoryTabs } from './CategoryTabs';
import { getProperties } from './categories';
import { useInspectorElement } from './hooks/useInspectorElement';
import { inspector as s } from '../styles';

export function Panel() {
  const { modeler } = useContext(ModelerContext);
  const { element } = useInspectorElement(modeler);
  const [isVisible, setIsVisible] = useState(true);

  // Sibling components (e.g. the navbar) re-center themselves when the
  // inspector is collapsed by reading this class.
  useEffect(() => {
    document.body.classList.toggle('inspector-collapsed', !isVisible);
    return () => document.body.classList.remove('inspector-collapsed');
  }, [isVisible]);

  const toggle = () => setIsVisible((v) => !v);

  return (
    <InspectorContext.Provider
      value={{
        element: element ?? undefined,
        businessObject: element ? getBusinessObject(element) : undefined,
      }}
    >
      <div className={s.wrapper}>
        <div
          data-testid="inspector-root"
          className={`${s.panel} ${isVisible ? '' : s.panelHidden}`}
        >
          {element && (
            <>
              <Header element={element} />
              <div className={s.panelBody}>
                <CategoryTabs
                  element={element}
                  categories={Object.entries(getProperties(element))}
                />
              </div>
            </>
          )}
        </div>
        {/*
          The toggle is rendered OUTSIDE the panel (which has backdrop-filter)
          so its `position: fixed` anchors to the viewport. Inside the panel,
          backdrop-filter establishes a new containing block and `fixed`
          would anchor to the panel - causing the button to shift between
          show / hide states.
        */}
        {element && (
          <ToggleButton isInspectorVisible={isVisible} onClick={toggle} />
        )}
      </div>
    </InspectorContext.Provider>
  );
}
