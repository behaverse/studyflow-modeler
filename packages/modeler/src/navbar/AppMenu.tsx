import logo_image from '#assets/img/logo.png';
import { useContext } from 'react';
import { Menu, MenuButton, MenuItem, MenuItems, MenuSeparator } from '@headlessui/react';
import { SettingsViewContext } from '@modeler/app/contexts';
import { useDialogs } from '@modeler/app/Dialogs';
import { MOD_LABEL, URLS } from '@modeler/constants';
import { ICONS } from '@modeler/icons';
import { appMenu as s } from '@modeler/navbar/styles';

type Entry = { label: string; icon: string; hint?: string; run: () => void };

/**
 * The app's menu: its logo, and its name where the row has room. It holds the app's own commands and nothing else: the
 * study's are the composer's, and the selection's the context pad's. ⌘K finds all of them by name.
 */
export function AppMenu() {
  const { openDialog } = useDialogs();
  const { openSettings } = useContext(SettingsViewContext);

  const groups: Entry[][] = [
    [
      { label: 'New...', icon: ICONS.fileNew, run: () => openDialog('gallery') },
      { label: 'Open File...', icon: ICONS.folderOpen, run: () => openDialog('open') },
      { label: 'Save As...', icon: ICONS.save, hint: `${MOD_LABEL}⇧S`, run: () => openDialog('save') },
    ],
    [
      { label: 'Settings', icon: ICONS.gear, run: openSettings },
      { label: 'Help', icon: ICONS.help, run: () => { window.open(URLS.docs, '_blank', 'noopener'); } },
    ],
  ];

  return (
    <>
      <Menu>
        <MenuButton title="Studyflow menu" aria-label="Studyflow menu" className={s.button}>
          <img src={logo_image} className={s.logo} alt="" />
          <span className={s.name}>
            <span className={s.nameLight}>Studyflow</span>
            <br />
            <span className={s.nameBold}>Modeler</span>
          </span>
          <i className={`${ICONS.caretDown} ${s.caret}`} aria-hidden="true" />
        </MenuButton>
        <MenuItems anchor="bottom start" className={s.menu}>
          {groups.map((group, index) => (
            <div key={group[0].label}>
              {index > 0 && <MenuSeparator className={s.separator} />}
              {group.map((entry) => (
                <MenuItem key={entry.label}>
                  <button type="button" className={s.item} onClick={entry.run}>
                    <i className={`${entry.icon} ${s.itemIcon}`} aria-hidden="true" />
                    <span className={s.itemLabel}>{entry.label}</span>
                    {entry.hint && <span className={s.itemHint}>{entry.hint}</span>}
                  </button>
                </MenuItem>
              ))}
            </div>
          ))}
        </MenuItems>
      </Menu>
      <div className={s.divider} />
    </>
  );
}
