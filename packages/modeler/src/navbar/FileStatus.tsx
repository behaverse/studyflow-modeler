import { useEffect, useSyncExternalStore } from 'react';
import { CloseButton, Popover, PopoverButton, PopoverPanel } from '@headlessui/react';
import { useDialogs } from '@modeler/app/Dialogs';
import { useModeler } from '@modeler/app/useModeler';
import { getLink, subscribeLink, supportsFileSystemAccess } from '@modeler/diagram/fileHandle';
import { saveLinkedFile } from '@modeler/diagram/save';
import { autoSavable } from '@modeler/diagram/formats';
import { filenameStem } from '@modeler/diagram/file';
import { getSettings, subscribeSettings } from '@modeler/settings/store';
import { APP_NAME } from '@modeler/constants';
import { describeFile, type Status } from '@modeler/navbar/fileState';
import { fileStatus as s } from '@modeler/navbar/styles';
import { text } from '@modeler/ui/styles';

const keepsBrowserCopy = () => getSettings().diagramAutoSave === 'local';
const writesToFile = () => getSettings().autoSaveToFile;

/** A file's name with its extension kept whole: with `truncate`, a long name gives way in its stem. */
function FileName({ name, truncate = false }: { name: string; truncate?: boolean }) {
  const stem = filenameStem(name);
  return (
    <span className={truncate ? s.fileName : 'font-mono'}>
      <span className={truncate ? s.stem : undefined}>{stem}</span>
      <span className={s.extension}>{name.slice(stem.length)}</span>
    </span>
  );
}

/** The status's words; short of room, `where` gives way first. */
function StatusWords({ status }: { status: Status }) {
  return (
    <>
      <i className={`${status.icon} ${s.icon}`} aria-hidden="true" />
      {status.where && <><span className={s.where}>{status.where}</span><span aria-hidden="true">·</span></>}
      <span className={s.label}>{status.label}</span>
    </>
  );
}

/**
 * The nav bar's title: the file the study saves into, or Untitled, over where its edits go (`navbar/fileState.ts`
 * decides which). A click opens the card that says so in full and holds what to do about it.
 */
export function FileStatus() {
  const modeler = useModeler();
  const { openDialog } = useDialogs();
  const link = useSyncExternalStore(subscribeLink, getLink, getLink);
  const keepsCopy = useSyncExternalStore(subscribeSettings, keepsBrowserCopy);
  const writes = useSyncExternalStore(subscribeSettings, writesToFile);
  const { place, name, status, detail, actions, lastSaved } = describeFile({
    link,
    keepsBrowserCopy: keepsCopy,
    writesToFile: writes,
    formatAutoSaves: !!link.file && autoSavable(link.file.format),
    canPickFiles: supportsFileSystemAccess(),
  });
  const tone = status.tone ? s[status.tone] : '';
  const run = { save: () => { void saveLinkedFile(modeler); }, saveAs: () => openDialog('save') };

  // The tab, and the desktop app's window, carry the same title, after the app's name.
  useEffect(() => { document.title = `${name ?? 'Untitled'} — ${APP_NAME}`; }, [name]);

  return (
    <Popover className="flex min-w-0">
      <PopoverButton
        data-testid="file-status"
        data-file-place={place}
        data-file-state={link.file ? link.state : undefined}
        className={s.title}
      >
        <span className={s.name}>{name ? <FileName name={name} truncate /> : 'Untitled'}</span>
        <span className={`${s.status} ${tone || text.muted}`}>
          <StatusWords status={status} />
        </span>
      </PopoverButton>

      <PopoverPanel anchor="bottom" className={s.card} data-testid="file-card">
        <div className={s.cardName}>{name ? <FileName name={name} /> : 'Untitled'}</div>
        <div className={`${s.cardStatus} ${tone || text.secondary}`}>
          <StatusWords status={status} />
        </div>
        {lastSaved && (
          <div className={s.cardText}>
            Last saved {new Date(lastSaved).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
          </div>
        )}
        <p className={s.cardText}>{detail}</p>
        <div className={s.actions}>
          {actions.map((action) => (
            <CloseButton key={action.label} className={action.primary ? s.primary : s.secondary} onClick={run[action.run]}>
              {action.label}
            </CloseButton>
          ))}
        </div>
      </PopoverPanel>
    </Popover>
  );
}
