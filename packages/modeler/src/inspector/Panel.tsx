import { useCallback, useEffect, useReducer, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { ICONS } from '@modeler/icons';
import { useRequiredModeler } from '@modeler/app/useModeler';
import { InspectorContext } from '@modeler/inspector/state';
import { CategoryTabs } from '@modeler/inspector/CategoryTabs';
import { getAttributesByCategory } from '@modeler/inspector/categories';
import { getTypeName, resolveDisplayName } from '@modeler/inspector/element';
import { clampPanelWidth, DEFAULT_PANEL_WIDTH } from '@modeler/inspector/panelWidth';
import { loadInspectorWidth, saveInspectorWidth } from '@modeler/settings/store';
import { inspector as s } from '@modeler/inspector/styles';
import { getEditorPort } from '@modeler/editor/registry';
import type { EditorPort } from '@modeler/editor/port';

function Header({ element }: { element: any }) {
  return (
    <>
      <h1 className={s.headerTitle}>{resolveDisplayName(element)}</h1>
      <h2 className={s.headerSubtitle}>{getTypeName(element)}</h2>
    </>
  );
}

function ToggleButton({ isInspectorVisible, onClick }: { isInspectorVisible: boolean; onClick: () => void }) {
  const title = isInspectorVisible ? 'Hide Inspector' : 'Show Inspector';
  const icon = isInspectorVisible ? ICONS.sidebarCollapse : ICONS.sidebarExpand;

  return (
    <button onClick={onClick} className={s.toggleButton} title={title}>
      <i className={`${icon} ${s.toggleIcon}`}></i>
    </button>
  );
}

function useSelectedElement(editor: EditorPort): any {
  const [element, setElement] = useState<any>(() => editor.elements.root());
  const [seededFor, setSeededFor] = useState<any>(editor);
  const [, bumpVersion] = useReducer((version) => version + 1, 0);
  const elementRef = useRef<any>(element);

  if (seededFor !== editor) {
    setSeededFor(editor);
    setElement(editor.elements.root());
  }

  // Matching `element.changed` against a ref keeps the subscription from re-establishing on every selection change.
  useEffect(() => {
    elementRef.current = element;
  }, [element]);

  useEffect(() => {
    const onRootSet = () => setElement(editor.elements.root());
    const onSelectionChanged = (e: any) => {
      const selection = e.newSelection ?? [];
      setElement(selection.length === 1 ? selection[0] : editor.elements.root());
    };
    const onElementChanged = (e: any) => {
      if (elementRef.current && e.element?.id === elementRef.current.id) bumpVersion();
    };

    editor.events.on('selection.changed', onSelectionChanged);
    editor.events.on('root.set', onRootSet);
    editor.events.on('element.changed', onElementChanged);

    return () => {
      editor.events.off('selection.changed', onSelectionChanged);
      editor.events.off('root.set', onRootSet);
      editor.events.off('element.changed', onElementChanged);
    };
  }, [editor]);

  return element;
}

export function Panel() {
  const modeler = useRequiredModeler();
  const element = useSelectedElement(getEditorPort(modeler));
  const [isVisible, setIsVisible] = useState(true);
  const [width, setWidth] = useState(() =>
    clampPanelWidth(loadInspectorWidth() ?? DEFAULT_PANEL_WIDTH, window.innerWidth));

  useEffect(() => {
    document.body.classList.toggle('inspector-collapsed', !isVisible);
    return () => document.body.classList.remove('inspector-collapsed');
  }, [isVisible]);

  useEffect(() => {
    document.body.style.setProperty('--inspector-width', `${width}px`);
  }, [width]);

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

const KEYBOARD_STEP = 24;

type Props = {
  width: number;
  onResize: (width: number) => void;
  onCommit: (width: number) => void;
};

function ResizeHandle({ width, onResize, onCommit }: Props) {
  const startDrag = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();

    const startX = event.clientX;
    const startWidth = width;
    let latest = startWidth;

    // The pointer leaves the strip the moment it moves, so the gesture is tracked on the window.
    const onMove = (moveEvent: globalThis.PointerEvent) => {
      latest = clampPanelWidth(startWidth + (startX - moveEvent.clientX), window.innerWidth);
      onResize(latest);
    };
    const onEnd = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
      document.body.classList.remove('resizing-inspector');
      onCommit(latest);
    };

    document.body.classList.add('resizing-inspector');
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
  }, [width, onResize, onCommit]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = event.key === 'ArrowLeft' ? width + KEYBOARD_STEP
      : event.key === 'ArrowRight' ? width - KEYBOARD_STEP
        : event.key === 'Home' ? DEFAULT_PANEL_WIDTH
          : undefined;
    if (next === undefined) return;
    event.preventDefault();
    onCommit(clampPanelWidth(next, window.innerWidth));
  };

  return (
    <div
      data-testid="inspector-resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize inspector"
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      onPointerDown={startDrag}
      onDoubleClick={() => onCommit(DEFAULT_PANEL_WIDTH)}
      onKeyDown={onKeyDown}
      className={s.resizeHandle}
    />
  );
}
