import logo_image from '@/assets/img/logo.png';
import { useState, useRef } from 'react';
import { useModeler } from '../useModeler';
import { SimulateButton } from './actions/Simulate';
import { RunButton } from './actions/Run';
import { CommandPalette, OPEN_PALETTE_SHORTCUT_LABEL } from '../dialogs';
import { useDiagramName } from './useDiagramName';
import { navbar, navBurgerBtnCls, navDividerCls } from '../styles';
import { ICONS } from '@/icons';

export function NavBar() {
  const modeler = useModeler();
  const { diagramName, rename } = useDiagramName(modeler);
  const [isEditingDiagramName, setIsEditingDiagramName] = useState(false);
  const paletteRef = useRef<{ open: () => void; close: () => void }>(null);

  return (
    <>
        <a href="../" target="_blank" className={navbar.brand}>
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
              <CommandPalette ref={paletteRef} />
              <button
                type="button"
                title={`Menu (${OPEN_PALETTE_SHORTCUT_LABEL})`}
                aria-label="Open command palette"
                className={navBurgerBtnCls}
                onClick={() => paletteRef.current?.open()}
              >
                <i className={`${ICONS.list} text-lg`}></i>
              </button>
            </>
          )}

          <div className={navbar.diagramSlot}>
            {isEditingDiagramName ? (
              <input
                type="text"
                value={diagramName}
                onChange={(e) => { if (e.target.value.length > 0) rename(e.target.value); }}
                onBlur={() => setIsEditingDiagramName(false)}
                onKeyDown={(e) => { if (e.key === 'Enter') setIsEditingDiagramName(false); }}
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

          {modeler && (
            <div className="hidden md:flex items-center flex-shrink-0">
              <div className={navDividerCls} />
              <SimulateButton />
              <RunButton />
            </div>
          )}
        </div>
    </>
  );
}
