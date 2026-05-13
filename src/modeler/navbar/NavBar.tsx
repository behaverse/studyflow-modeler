import logo_image from '@/assets/img/logo.png';
import { useState, useContext, useEffect, useCallback, useRef } from 'react';
import {
  DiagramNameContext,
  ModelerContext,
  SettingsViewContext,
  SimulationContext,
} from '../contexts';
import CommandMenu from './CommandMenu';
import { CommandPalette, OPEN_PALETTE_SHORTCUT_LABEL } from '../dialogs';
import { navbar, navBurgerBtnCls } from '../styles';

const DEFAULT_DIAGRAM_NAME = 'Untitled Diagram';

function readProcessName(modeler: any): string | undefined {
  const rootElement = modeler?.get('canvas')?.getRootElement?.();
  const name = rootElement?.businessObject?.name;
  return typeof name === 'string' && name.length > 0 ? name : undefined;
}

export function NavBar() {
  const { modeler } = useContext(ModelerContext);
  const { openSettings } = useContext(SettingsViewContext);
  const [diagramName, setDiagramNameState] = useState(DEFAULT_DIAGRAM_NAME);
  const [isEditingDiagramName, setIsEditingDiagramName] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);
  const paletteRef = useRef<{ open: () => void; close: () => void }>(null);

  const setDiagramName = useCallback(
    (name: string) => {
      setDiagramNameState(name);
      if (!modeler) return;
      const rootElement = modeler.get('canvas')?.getRootElement?.();
      if (!rootElement) return;
      const modelValue = name === DEFAULT_DIAGRAM_NAME ? undefined : name;
      if (rootElement.businessObject.name !== modelValue) {
        modeler.get('modeling').updateProperties(rootElement, { name: modelValue });
      }
    },
    [modeler],
  );

  useEffect(() => {
    if (!modeler) return;
    const eventBus = modeler.get('eventBus');
    const canvas = modeler.get('canvas');
    const sync = () => {
      setDiagramNameState(readProcessName(modeler) ?? DEFAULT_DIAGRAM_NAME);
    };
    const onElementChanged = (event: any) => {
      if (event?.element === canvas.getRootElement()) sync();
    };
    sync();
    eventBus.on('import.done', sync);
    eventBus.on('element.changed', onElementChanged);
    return () => {
      eventBus.off('import.done', sync);
      eventBus.off('element.changed', onElementChanged);
    };
  }, [modeler]);

  return (
    <SimulationContext.Provider value={{ isSimulating, setIsSimulating }}>
    <DiagramNameContext.Provider value={{ diagramName, setDiagramName }}>
      <a
        href="../"
        target="_blank"
        className={navbar.brand}
      >
        <img src={logo_image} className={navbar.brandImage} alt="Studyflow Modeler" title="Studyflow Modeler" />
        <span className={navbar.brandWordmark}>
          <span className={navbar.brandWordmarkLight}>Studyflow</span>
          <br />
          <span className={navbar.brandWordmarkBold}>Modeler</span>
        </span>
      </a>

      <div className={navbar.shell}>
        {modeler && (
          <>
            <CommandPalette ref={paletteRef} openSettings={openSettings} />
            <button
              type="button"
              title={`Menu (${OPEN_PALETTE_SHORTCUT_LABEL})`}
              aria-label="Open command palette"
              className={navBurgerBtnCls}
              onClick={() => paletteRef.current?.open()}
            >
              <i className="iconify bi--list text-lg"></i>
            </button>
          </>
        )}

        <div className={navbar.diagramSlot}>
          {isEditingDiagramName ? (
            <input
              type="text"
              value={diagramName}
              onChange={(e) =>
                e.target.value.length > 0 ? setDiagramName(e.target.value) : undefined
              }
              onBlur={() => setIsEditingDiagramName(false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setIsEditingDiagramName(false);
              }}
              autoFocus
              maxLength={120}
              minLength={1}
              className={navbar.diagramNameInput}
            />
          ) : (
            <span
              className={navbar.diagramName}
              title="Click to edit diagram name"
              onClick={() => setIsEditingDiagramName(true)}
            >
              {diagramName}
            </span>
          )}
        </div>

        {modeler && <CommandMenu />}
      </div>
    </DiagramNameContext.Provider>
    </SimulationContext.Provider>
  );
}
