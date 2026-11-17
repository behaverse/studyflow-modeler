import logo_image from '#assets/img/logo.png';
import { useRef } from 'react';
import { CommandPalette, OPEN_PALETTE_SHORTCUT_LABEL, type CommandPaletteHandle } from '@modeler/commandPalette/CommandPalette';
import { ICONS } from '@modeler/icons';
import { appMenu as s } from '@modeler/navbar/styles';

/** The app's menu: its logo, and its name where the row has room, which open the command palette. */
export function AppMenu() {
  const paletteRef = useRef<CommandPaletteHandle>(null);

  return (
    <>
      <CommandPalette ref={paletteRef} />
      <button
        type="button"
        title={`Menu (${OPEN_PALETTE_SHORTCUT_LABEL} or /)`}
        aria-label="Open command palette"
        className={s.button}
        onClick={() => paletteRef.current?.open()}
      >
        <img src={logo_image} className={s.logo} alt="" />
        <span className={s.name}>
          <span className={s.nameLight}>Studyflow</span>
          <br />
          <span className={s.nameBold}>Modeler</span>
        </span>
        <i className={`${ICONS.caretDown} ${s.caret}`} aria-hidden="true" />
      </button>
      <div className={s.divider} />
    </>
  );
}
