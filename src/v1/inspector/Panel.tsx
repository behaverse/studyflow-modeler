import { useContext, useState } from 'react';
import { getBusinessObject } from 'bpmn-js/lib/util/ModelUtil';
import { ModelerContext, InspectorContext } from '../contexts';
import { ToggleButton } from './ToggleButton';
import { PropertyHeader } from './components/PropertyHeader';
import { CategoryTabs } from './components/CategoryTabs';
import { getProperties } from './categories';
import { useInspectorElement } from './hooks/useInspectorElement';

export function Panel({ className: _className = '' }: { className?: string }) {
  const { modeler } = useContext(ModelerContext);
  const { element } = useInspectorElement(modeler);
  const [isVisible, setIsVisible] = useState(true);

  return (
    <InspectorContext.Provider
      value={{
        element: element ?? undefined,
        businessObject: element ? getBusinessObject(element) : undefined,
      }}
    >
      <div className="fixed top-12 right-0 flex items-start">
        {element && (
          <ToggleButton
            isInspectorVisible={isVisible}
            onClick={() => setIsVisible(!isVisible)}
          />
        )}
        <div
          data-testid="inspector-root"
          className={`w-72 rounded-bl-[14px] bg-stone-800/90 backdrop-blur-2xl
                      shadow-[0_2px_8px_rgba(0,0,0,0.20),0_8px_24px_rgba(0,0,0,0.25),inset_0_1px_0_rgba(255,255,255,0.08)]
                      text-stone-100 max-h-[calc(100vh-72px)] overflow-y-auto
                      ${isVisible ? '' : 'hidden'}`}
        >
          {element && (
            <>
              <PropertyHeader element={element} />
              <div className="w-full">
                <CategoryTabs
                  element={element}
                  categories={Object.entries(getProperties(element))}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </InspectorContext.Provider>
  );
}
