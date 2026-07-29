import { useEffect, useState } from 'react';
import { InspectorContext } from '@/modeler/infra/contexts';
import { useModeler } from '@/modeler/views/useModeler';
import { ToggleButton } from '@/modeler/views/inspector/ToggleButton';
import { ResizeHandle } from '@/modeler/views/inspector/ResizeHandle';
import { Header } from '@/modeler/views/inspector/Header';
import { CategoryTabs } from '@/modeler/views/inspector/CategoryTabs';
import { getAttributesByCategory } from '@/modeler/models/inspector/categories';
import { useSelectedElement } from '@/modeler/views/inspector/hooks/useSelectedElement';
import { clampPanelWidth, DEFAULT_PANEL_WIDTH } from '@/modeler/models/inspector/panelWidth';
import { loadInspectorWidth, saveInspectorWidth } from '@/modeler/infra/settings/inspectorWidth';
import { inspector as s } from '@/modeler/infra/styles';

export function Panel() {
  const modeler = useModeler();
  const element = useSelectedElement(modeler);
  const [isVisible, setIsVisible] = useState(true);
  const [width, setWidth] = useState(() =>
    clampPanelWidth(loadInspectorWidth() ?? DEFAULT_PANEL_WIDTH, window.innerWidth));

  // The navbar re-centers itself by reading this body class.
  useEffect(() => {
    document.body.classList.toggle('inspector-collapsed', !isVisible);
    return () => document.body.classList.remove('inspector-collapsed');
  }, [isVisible]);

  // Published so the navbar's safe area follows the panel as it is dragged.
  useEffect(() => {
    document.body.style.setProperty('--inspector-width', `${width}px`);
  }, [width]);

  // A window narrow enough to squeeze the canvas re-clamps the panel.
  useEffect(() => {
    const onResize = () => setWidth((current) => clampPanelWidth(current, window.innerWidth));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const commitWidth = (next: number) => {
    setWidth(next);
    saveInspectorWidth(next);
  };

  const toggle = () => setIsVisible((v) => !v);

  return (
    <InspectorContext.Provider value={{ element }}>
      <div className={s.wrapper}>
        <div
          data-testid="inspector-root"
          className={`${s.panel} ${isVisible ? '' : s.panelHidden}`}
          style={{ width }}
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
          <>
            {isVisible && (
              <ResizeHandle width={width} onResize={setWidth} onCommit={commitWidth} />
            )}
            <ToggleButton isInspectorVisible={isVisible} onClick={toggle} />
          </>
        )}
      </div>
    </InspectorContext.Provider>
  );
}
