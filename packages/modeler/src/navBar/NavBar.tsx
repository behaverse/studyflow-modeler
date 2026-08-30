import logo_image from '#assets/img/logo.png';
import { useState, useRef } from 'react';
import { useModeler, useRequiredModeler } from '@modeler/app/useModeler';
import { executeCommand } from '@modeler/commandBus';
import { openRunnerTab } from '@modeler/app/commands';
import { notify } from '@modeler/app/noticeStore';
import { useIsSimulating } from '@modeler/simulation/useIsSimulating';
import { CommandPalette, OPEN_PALETTE_SHORTCUT_LABEL } from '@modeler/commandPalette/CommandPalette';
import { useDiagramName } from '@modeler/navBar/useDiagramName';
import { FileStatus } from '@modeler/navBar/FileStatus';
import { surface, shadow, border, text, radius, button } from '@modeler/ui/styles';
import { ICONS } from '@modeler/icons';

const navbar = {
  brand: 'fixed top-2 left-0 z-50 flex items-center gap-2.5 px-1.5 h-12 select-none',
  brandImage: 'h-12 w-12 shrink-0',
  /* The wordmark is the first thing to go when the top row gets tight: it is a
     label on a logo that already identifies the app, and the two buttons it
     would crowd out are not. `--brand-gutter` flips at the same 1024px. */
  brandWordmark: 'hidden lg:inline-block text-base leading-none select-none text-violet-800',
  brandWordmarkLight: 'font-light',
  brandWordmarkBold: 'font-semibold',

  /* Centred in the gap the brand and the inspector leave, at every width and
     every UI scale -- see the `--navbar-*` note in `assets/css/app.css`. */
  shell: `fixed top-2 z-50 flex items-center h-10
          left-[var(--navbar-left)] -translate-x-1/2 max-w-[var(--navbar-max-width)]
          ${radius.card} ${surface.chrome} ${border.hairline} ${shadow.panelFlat}
          px-1.5`,

  diagramSlot: 'flex items-center min-w-0 flex-shrink',
  diagramName: `text-sm font-medium ${text.secondary} cursor-pointer px-2 py-1 ${radius.field} hover:bg-black/[0.05] transition-colors truncate`,
  diagramNameInput: `text-sm font-medium ${text.primary} ${surface.card} ${radius.field} px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-[hsl(205,100%,45%)]`,

  menuContainer: 'flex items-center gap-0.5 ml-1 flex-shrink-0',
} as const;

const navBurgerBtnCls =
  'inline-flex items-center justify-center text-lg font-medium text-stone-700 hover:text-stone-900 hover:bg-black/[0.05] active:bg-black/[0.08] rounded-md h-7 w-7 transition-colors';

const navDividerCls = 'w-px h-4 bg-black/[0.10] mr-2 ml-2';

const SIMULATE_BASE = `${button.action} rounded-l-lg`;
const SIMULATE_ACTIVE = 'bg-red-700 hover:bg-red-800';
const SIMULATE_IDLE = button.accentFill;

function SimulateButton() {
  const modeler = useRequiredModeler();
  const isSimulating = useIsSimulating(modeler);

  return (
    <button
      type="button"
      title={isSimulating ? 'Stop simulation' : 'Simulate the studyflow'}
      className={`${SIMULATE_BASE} ${isSimulating ? SIMULATE_ACTIVE : SIMULATE_IDLE}`}
      onClick={() => executeCommand(modeler, { type: 'ToggleSimulation' })}
    >
      {isSimulating ? (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
          <rect x="2" y="2" width="12" height="12" rx="1.5" />
        </svg>
      ) : (
        'Simulate'
      )}
    </button>
  );
}

const RUN_BUTTON_CLS = 'inline-flex items-center justify-center gap-1.5 text-sm font-semibold rounded-r-lg h-7 px-3.5 transition-colors text-white bg-[#520BBF] hover:bg-[#4309A2] disabled:opacity-50 disabled:cursor-wait';

function RunButton() {
  const modeler = useModeler();
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    if (!modeler || busy) return;
    // Claimed before the first `await`, while this click still counts as a user gesture.
    const target = openRunnerTab();
    setBusy(true);
    try {
      await executeCommand(modeler, { type: 'OpenRunner', target });
    } catch (err) {
      notify('error', err instanceof Error ? err.message : 'Could not start the runner. Try again, or reload the page.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      title="Open this studyflow in the  runner"
      disabled={busy}
      className={RUN_BUTTON_CLS}
      onClick={handleClick}
    >
      Run
    </button>
  );
}

export function NavBar() {
  const modeler = useRequiredModeler();
  const { diagramName, rename } = useDiagramName(modeler);
  // Local draft while editing; the model is written once on Enter/blur (one undo step).
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const isEditingDiagramName = nameDraft !== null;
  const startEditingDiagramName = () => setNameDraft(diagramName);
  const finishEditingDiagramName = () => {
    if (nameDraft !== null && nameDraft.length > 0) rename(nameDraft);
    setNameDraft(null);
  };
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
                value={nameDraft ?? ''}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={finishEditingDiagramName}
                onKeyDown={(e) => { if (e.key === 'Enter') finishEditingDiagramName(); }}
                autoFocus
                data-testid="diagram-name-input"
                maxLength={120}
                minLength={1}
                className={navbar.diagramNameInput}
              />
            ) : (
              <span
                className={navbar.diagramName}
                title="Click to edit diagram name"
                onClick={startEditingDiagramName}
              >
                {diagramName}
              </span>
            )}
            {modeler && <FileStatus />}
          </div>

          {modeler && (
            <div className="hidden sm:flex items-center flex-shrink-0">
              <div className={navDividerCls} />
              <SimulateButton />
              <RunButton />
            </div>
          )}
        </div>
    </>
  );
}
