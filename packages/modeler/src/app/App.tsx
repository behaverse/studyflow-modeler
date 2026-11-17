import { useEffect, useMemo, useState } from 'react';
import { Modeler } from '@modeler/app/Modeler';
import { ModeContext, ModelerContext, SettingsViewContext, type AppMode } from '@modeler/app/contexts';
import { DialogHost, DialogProvider } from '@modeler/app/Dialogs';
import { ReplayPanel } from '@modeler/provenance/Replay';
import { NavBar } from '@modeler/navbar/NavBar';
import { Notices } from '@modeler/app/Notices';
import { Panel as InspectorPanel } from '@modeler/inspector/Panel';
import { Palette } from '@modeler/palette/Palette';
import { PopupMenus } from '@modeler/popup/PopupMenus';
import { ContextPad } from '@modeler/contextPad/ContextPad';
import { SettingsView } from '@modeler/settings/SettingsView';
import { useIsSimulating } from '@modeler/simulation/useIsSimulating';
import type { Editor } from '@modeler/editor/port';

export function App() {
  const [modeler, setModeler] = useState<Editor | undefined>(undefined);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isReplaying, setIsReplaying] = useState(false);
  // Below 900px an open inspector leaves no canvas worth drawing on, so it starts out of the way; the nav bar's
  // toggle floats it over the canvas.
  const [isInspectorVisible, setIsInspectorVisible] = useState(() => window.innerWidth > 900);
  const isSimulating = useIsSimulating(modeler);
  const mode: AppMode = isReplaying ? 'replay' : isSimulating ? 'simulation' : 'edit';
  const modeValue = useMemo(() => ({
    mode,
    openReplay: () => setIsReplaying(true),
    exitReplay: () => setIsReplaying(false),
  }), [mode]);

  // The editor fitted its first diagram before the app drew its chrome over the canvas: fit it again, clear of it.
  useEffect(() => {
    modeler?.canvas.zoom('fit');
  }, [modeler]);

  return (
    <ModelerContext.Provider value={modeler}>
      <ModeContext.Provider value={modeValue}>
      <SettingsViewContext.Provider value={{ openSettings: () => setIsSettingsOpen(true) }}>
      <DialogProvider>
        <div className={`App flex flex-col h-screen${mode === 'simulation' ? ' simulation-active' : ''}${mode === 'replay' ? ' replay-active' : ''}`} data-testid="modeler-app">
          {modeler && <div data-testid="modeler-ready" aria-hidden="true" className="hidden" />}
          {modeler && (
            <NavBar isInspectorVisible={isInspectorVisible} onToggleInspector={() => setIsInspectorVisible((visible) => !visible)} />
          )}
          <div className="w-full h-full">
            <div className="flex flex-row h-full overflow-hidden relative">
              {modeler && <Palette className="md:flex studyflow-palette" />}
              <Modeler onReady={setModeler} />
            </div>
          </div>
          {/* A replay shows its own panel in the inspector's place. */}
          {modeler && mode !== 'replay' && (
            <div className="studyflow-inspector" data-testid="inspector-shell">
              <InspectorPanel isVisible={isInspectorVisible} />
            </div>
          )}
          {modeler && mode === 'replay' && <ReplayPanel onClose={modeValue.exitReplay} />}
          {/* App-rendered popup menus (`bpmn-create` / `bpmn-append` / `color-picker`)
              and the per-shape context pad that opens two of them. The pad is the app's
              only selection affordance and stands down during a replay, where the
              document is read-only. */}
          {modeler && <PopupMenus />}
          {modeler && mode !== 'replay' && <ContextPad />}
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
