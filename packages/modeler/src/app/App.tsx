import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useCanvasView } from '@modeler/app/canvasView';
import { Modeler } from '@modeler/app/Modeler';
import { ModeContext, ModelerContext, SettingsViewContext, type AppMode } from '@modeler/app/contexts';
import { DialogHost, DialogProvider } from '@modeler/app/Dialogs';
import { NavBar } from '@modeler/navbar/NavBar';
import { Composer } from '@modeler/composer/Composer';
import { PaletteProvider } from '@modeler/commandPalette/PaletteProvider';
import { Notices } from '@modeler/app/Notices';
import { Panel as InspectorPanel } from '@modeler/inspector/Panel';
import { Palette } from '@modeler/palette/Palette';
import { PopupMenus } from '@modeler/popup/PopupMenus';
import { ContextPad } from '@modeler/contextPad/ContextPad';
import { SettingsView } from '@modeler/settings/SettingsView';
import { useIsSimulating } from '@modeler/simulation/useIsSimulating';
import { useInspectorShown } from '@modeler/inspector/visibility';
import { Drawer } from '@modeler/views/Drawer';
import { useReview } from '@modeler/review/store';
import { SKILL_CANVAS_VIEWS } from '@modeler/skillModules';
import { attachReviewWatch } from '@modeler/review/watch';
import type { Editor } from '@modeler/editor/port';

export function App() {
  const [modeler, setModeler] = useState<Editor | undefined>(undefined);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isReplaying, setIsReplaying] = useState(false);
  // Closed, a selected step shows the inline inspector on the canvas; the nav bar's toggle and its All properties open it.
  const isInspectorVisible = useInspectorShown();
  // A skill's view stands in for the canvas while editing (`CanvasView`).
  const shownView = useCanvasView();
  const canvasView = modeler ? SKILL_CANVAS_VIEWS.find((view) => view.id === shownView) : undefined;
  const isSimulating = useIsSimulating(modeler);
  // A version written into the linked file elsewhere waits for the user over everything else (`review/`).
  const review = useReview();
  const mode: AppMode = review ? 'review' : isReplaying ? 'replay' : isSimulating ? 'simulation' : 'edit';
  const modeValue = useMemo(() => ({
    mode,
    openReplay: () => setIsReplaying(true),
    exitReplay: () => setIsReplaying(false),
  }), [mode]);

  // The editor fitted its first diagram before the app drew its chrome over the canvas: fit it again, clear of it.
  useEffect(() => {
    modeler?.canvas.zoom('fit');
  }, [modeler]);

  // The linked file is watched for a version written into it elsewhere, which comes in for review while editing.
  const modeRef = useRef(mode);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => (modeler ? attachReviewWatch(modeler, () => modeRef.current !== 'edit') : undefined), [modeler]);

  return (
    <ModelerContext.Provider value={modeler}>
      <ModeContext.Provider value={modeValue}>
      <SettingsViewContext.Provider value={{ openSettings: () => setIsSettingsOpen(true) }}>
      <DialogProvider>
        <div className={`App flex flex-col h-screen${mode === 'edit' ? '' : ` ${mode}-active`}${canvasView && mode === 'edit' ? ' canvas-view-active' : ''}`} data-testid="modeler-app">
          {modeler && <div data-testid="modeler-ready" aria-hidden="true" className="hidden" />}
          {/* One command palette, which the composer opens (and ⌘K); the context pad's commands are in it by name. */}
          {modeler && (
            <PaletteProvider>
              <NavBar />
              <Composer />
              {/* The per-shape context pad, the selection's own commands. It stands down during a replay and a review,
                  where the document is read-only. */}
              {mode !== 'replay' && mode !== 'review' && !canvasView && <ContextPad />}
              {mode === 'edit' && canvasView && <Suspense fallback={null}><canvasView.View /></Suspense>}
            </PaletteProvider>
          )}
          <div className="w-full h-full">
            <div className="flex flex-row h-full overflow-hidden relative">
              {modeler && <Palette className="md:flex studyflow-palette" />}
              <Modeler onReady={setModeler} />
            </div>
          </div>
          {/* A replay is read-only: its minimap, over the composer, stands in for the inspector. */}
          {modeler && mode !== 'replay' && (
            <div className="studyflow-inspector" data-testid="inspector-shell">
              <InspectorPanel isVisible={isInspectorVisible} />
            </div>
          )}
          {/* The views' drawer under the canvas: the schedule, the checklists, the provenance. */}
          {modeler && mode === 'edit' && <Drawer />}
          {/* App-rendered popup menus: the Add panel after the selection or where the canvas was double-clicked, Change element, Style. */}
          {modeler && <PopupMenus />}
          {modeler && <DialogHost />}
          {isSettingsOpen && <SettingsView onClose={() => setIsSettingsOpen(false)} />}
          <Notices />
        </div>
      </DialogProvider>
      </SettingsViewContext.Provider>
      </ModeContext.Provider>
    </ModelerContext.Provider>
  );
}
