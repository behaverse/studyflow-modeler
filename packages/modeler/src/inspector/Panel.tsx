import { useCallback, useEffect, useReducer, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useModeler } from '@modeler/app/useModeler';
import { InspectorContext } from '@modeler/inspector/hooks';
import { CategoryTabs } from '@modeler/inspector/CategoryTabs';
import { getAttributesByCategory } from '@modeler/inspector/categories';
import { getTypeName, resolveDisplayName } from '@modeler/inspector/element';
import { clampPanelWidth, defaultPanelWidth, fromStoredWidth, toStoredWidth } from '@modeler/inspector/panelWidth';
import { loadInspectorWidth, saveInspectorWidth } from '@modeler/settings/store';
import { publishInspectorWidth } from '@modeler/inspector/visibility';
import { inspector as s } from '@modeler/inspector/styles';
import { useReview, type ReviewChange } from '@modeler/review/store';
import type { Element, StudyModel } from '@core/model/index';
import type { Editor } from '@modeler/editor/port';

/** What a review says of the inspected element: what the version on disk did to it, and that it reads only. */
function reviewNote(change: ReviewChange | undefined): string {
  const then = 'Read-only until you accept or discard it.';
  if (change?.kind === 'added') return `New in the version on disk. ${then}`;
  if (change?.kind === 'changed' && change.what.length > 0) return `Changed on disk: ${change.what.join(', ')}. ${then}`;
  return 'Read-only while you review the version on disk.';
}

/**
 * The inspected element's name and type. The accent dot says it is the selection, which wears the same accent on the
 * canvas, the context pad and the composer's chip. The name keeps to one line: a long one, written into its field,
 * would otherwise grow the header as the field lets go of it, and move what the pointer was about to press.
 */
function Header({ element, model, selected, review }: {
  element: Element;
  model: StudyModel;
  selected: number;
  /** Set while a version on disk is under review: what it did to this element, if anything. */
  review?: { change: ReviewChange | undefined };
}) {
  const name = resolveDisplayName(model, element);
  return (
    <>
      <h1 className={s.headerTitle} title={name}>
        {selected === 1 && <span className={s.selectedDot} title="Selected on the canvas" />}
        <span className={s.headerName}>{name}</span>
      </h1>
      <h2 className={s.headerSubtitle}>{getTypeName(model, element)}</h2>
      {review && <p className={s.headerReview} data-testid="inspector-review">{reviewNote(review.change)}</p>}
    </>
  );
}

/**
 * The id of the element the inspector shows: the one selected element (for a caption, the element it captions),
 * else the container the view is drilled into, or the document root.
 */
function inspected(editor: Editor, selection: readonly string[]): string {
  const id = selection.length === 1 ? selection[0] : editor.canvas.scope ?? editor.study.root.id;
  const record = editor.study.get(id);
  return record?.kind === 'label' && record.owner ? record.owner : id;
}

/**
 * The inspected element as the study holds it now, read again after every change so it is never an older one, and
 * how many elements the canvas has selected.
 */
function useInspected(editor: Editor): { element: Element | undefined; selected: number } {
  const [id, setId] = useState<string>(() => inspected(editor, editor.canvas.selection));
  const [selected, setSelected] = useState(() => editor.canvas.selection.length);
  const [, bumpVersion] = useReducer((version) => version + 1, 0);

  useEffect(() => {
    const onRootSet = () => { setId(inspected(editor, [])); setSelected(0); };
    const onSelectionChanged = (e: any) => {
      const selection: readonly string[] = e.newSelection ?? [];
      setId(inspected(editor, selection));
      setSelected(selection.length);
    };

    editor.events.on('SelectionChanged', onSelectionChanged);
    editor.events.on('RootSet', onRootSet);
    const stopListening = editor.study.on('change', bumpVersion);

    return () => {
      editor.events.off('SelectionChanged', onSelectionChanged);
      editor.events.off('RootSet', onRootSet);
      stopListening();
    };
  }, [editor]);

  return { element: editor.study.element(id), selected };
}

/** The inspector; whether it shows is the app's, whose nav bar holds its toggle. */
export function Panel({ isVisible }: { isVisible: boolean }) {
  const modeler = useModeler();
  const { element, selected } = useInspected(modeler);
  const { model } = modeler.study;
  // While a version on disk is under review the inspector shows it, read-only (`review/`).
  const review = useReview();
  const [width, setWidth] = useState(() =>
    clampPanelWidth(fromStoredWidth(loadInspectorWidth() ?? undefined), window.innerWidth));
  // The width the user chose, independent of the scale. A resize that crosses a
  // `--ui-scale` step re-derives from this, so the panel grows with its contents.
  const baseWidth = useRef(toStoredWidth(width));

  useEffect(() => {
    const onResize = () => setWidth(clampPanelWidth(fromStoredWidth(baseWidth.current), window.innerWidth));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // What the views' drawer keeps clear of, as the inspector opens, closes and is resized.
  const shows = isVisible && !!element;
  useEffect(() => publishInspectorWidth(shows ? width : 0), [shows, width]);

  const commitWidth = (next: number) => {
    setWidth(next);
    baseWidth.current = toStoredWidth(next);
    saveInspectorWidth(baseWidth.current);
  };

  return (
    <InspectorContext.Provider value={{ element, model }}>
      <div className={s.wrapper}>
        <div
          data-testid="inspector-root"
          data-covers={isVisible && element ? 'right' : undefined}
          className={`${s.panel} ${isVisible ? '' : s.panelHidden}`}
          style={{ width }}
        >
          {element && isVisible && (
            <>
              <Header
                element={element}
                model={model}
                selected={selected}
                review={review && { change: review.changes.find((change) => change.id === element.id) }}
              />
              <div className={s.panelBody}>
                <CategoryTabs
                  element={element}
                  categories={Object.entries(getAttributesByCategory(model, element))}
                  readOnly={!!review}
                />
              </div>
            </>
          )}
        </div>
        {/* Outside the panel: the handle must not scroll with it. */}
        {element && isVisible && <ResizeHandle width={width} onResize={setWidth} onCommit={commitWidth} />}
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
        : event.key === 'Home' ? defaultPanelWidth()
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
      onDoubleClick={() => onCommit(defaultPanelWidth())}
      onKeyDown={onKeyDown}
      className={s.resizeHandle}
    />
  );
}
