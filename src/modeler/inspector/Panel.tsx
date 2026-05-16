import { useEffect, useState } from 'react';
import { InspectorContext } from '../contexts';
import { useModeler } from '../useModeler';
import { ToggleButton } from './ToggleButton';
import { Header } from './Header';
import { CategoryTabs } from './CategoryTabs';
import { getAttributesByCategory } from './categories';
import { useSelectedElement } from './hooks/useSelectedElement';
import { inspector as s } from '../styles';

export function Panel() {
  const modeler = useModeler();
  const element = useSelectedElement(modeler);
  const [isVisible, setIsVisible] = useState(true);

  // The navbar re-centers itself by reading this body class.
  useEffect(() => {
    document.body.classList.toggle('inspector-collapsed', !isVisible);
    return () => document.body.classList.remove('inspector-collapsed');
  }, [isVisible]);

  const toggle = () => setIsVisible((v) => !v);

  return (
    <InspectorContext.Provider value={{ element }}>
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
                  categories={Object.entries(getAttributesByCategory(element))}
                />
              </div>
            </>
          )}
        </div>
        {/* Outside the panel so position:fixed anchors to the viewport, not the backdrop-filter context. */}
        {element && (
          <ToggleButton isInspectorVisible={isVisible} onClick={toggle} />
        )}
      </div>
    </InspectorContext.Provider>
  );
}
