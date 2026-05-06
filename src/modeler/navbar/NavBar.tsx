import logo_image from '@/assets/img/logo.png';
import { useState, useContext, useRef } from 'react';
import {
  DiagramNameContext,
  ModelerContext,
  SettingsViewContext,
  SimulationContext,
} from '../contexts';
import CommandMenu from './CommandMenu';
import { CommandPalette } from '../dialogs';
import { navbar, navBurgerBtnCls } from '../styles';

export function NavBar() {
  const { modeler } = useContext(ModelerContext);
  const { openSettings } = useContext(SettingsViewContext);
  const [diagramName, setDiagramName] = useState('Untitled Diagram');
  const [isEditingDiagramName, setIsEditingDiagramName] = useState(false);
  const [isSimulating, setIsSimulating] = useState(false);
  const paletteRef = useRef<{ open: () => void; close: () => void }>(null);

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
              title="Menu (⌘K)"
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
