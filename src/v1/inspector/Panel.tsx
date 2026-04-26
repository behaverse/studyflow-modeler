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
      <div className="fixed top-0 right-0 z-[60] flex items-start">
        {element && (
          <ToggleButton
            isInspectorVisible={isVisible}
            onClick={() => setIsVisible(!isVisible)}
          />
        )}
        <div
          data-testid="inspector-root"
          className={`w-72 rounded-bl-[14px] bg-[#ece5d0]/95 backdrop-blur-2xl
                      border border-[#b0a993]/40 border-t-0 border-r-0
                      shadow-[0_2px_8px_rgba(0,0,0,0.08),0_8px_24px_rgba(0,0,0,0.10),inset_0_1px_0_rgba(255,255,255,0.6)]
                      text-stone-800 max-h-[calc(100vh-80px)] overflow-y-auto
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
