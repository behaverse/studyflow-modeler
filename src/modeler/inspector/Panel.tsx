import { useContext, useState } from 'react';
import { getBusinessObject } from 'bpmn-js/lib/util/ModelUtil';
import { ModelerContext, InspectorContext } from '../contexts';
import { ToggleButton } from './ToggleButton';
import { Header } from './Header';
import { CategoryTabs } from './CategoryTabs';
import { getProperties } from './categories';
import { useInspectorElement } from './hooks/useInspectorElement';
import { inspector as s } from './styles';

export function Panel() {
  const { modeler } = useContext(ModelerContext);
  const { element } = useInspectorElement(modeler);
  const [isVisible, setIsVisible] = useState(true);

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
              <ToggleButton isInspectorVisible={isVisible} onClick={toggle} />
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
        {element && !isVisible && (
          <ToggleButton isInspectorVisible={isVisible} onClick={toggle} />
        )}
      </div>
    </InspectorContext.Provider>
  );
}
