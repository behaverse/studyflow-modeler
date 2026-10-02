import { useMemo, useState, useSyncExternalStore } from 'react';
import { Modal } from '@modeler/ui/Modal';
import { SCHEMAS, SCHEMA_LOAD_FAILURES } from '@core/notation/loader';
import { installedSchemas } from '@modeler/app/installedSchemas';
import { schemaDiagnostics } from '@core/notation';
import { ICONS } from '@modeler/icons';
import { URLS } from '@modeler/constants';
import { supportsFileSystemAccess } from '@modeler/diagram/fileHandle';
import {
  clearAllLocalData,
  getSettings,
  getStorageEstimate,
  resetSettings,
  setSettings,
  subscribeSettings,
  type Settings,
} from '@modeler/settings/store';
import { Row, SectionHeader, SelectControl, ToggleControl } from '@modeler/settings/controls';
import type { SettingsSection } from '@modeler/settings/sections';
import { SKILL_SETTINGS_SECTIONS } from '@modeler/skillModules';
import { settingsView as s } from '@modeler/settings/styles';

function useSettings(): {
  settings: Settings;
  update: (partial: Partial<Settings>) => void;
  reset: () => void;
} {
  const settings = useSyncExternalStore(subscribeSettings, getSettings, getSettings);
  return {
    settings,
    update: setSettings,
    reset: resetSettings,
  };
}

function AboutSection() {
  const version = (import.meta as any).env?.APP_VERSION ?? 'dev';
  return (
    <>
      <SectionHeader title="About" description="Draw, simulate, and publish studyflows. Built on BPMN 2.0." />

      <Row label="Version" control={<span className={s.valueChip}>{String(version)}</span>} />
      <Row
        label="Source code"
        control={
          <a
            href={URLS.githubRepo}
            target="_blank"
            rel="noreferrer"
            className={s.inlineBtn}
          >
            GitHub ↗
          </a>
        }
      />
      <Row
        label="Documentation"
        control={
          <a href={URLS.docs} target="_blank" rel="noreferrer" className={s.inlineBtn}>
            Docs ↗
          </a>
        }
      />
    </>
  );
}

function EditorSection() {
  const { settings, update } = useSettings();

  return (
    <>
      <SectionHeader title="Editor" description="How the canvas and inspector behave." />

      <Row
        label="Snap to grid"
        help="Land dragged, resized and newly created elements on the grid. Turn this off to place them freely."
        control={
          <ToggleControl
            label="Snap to grid"
            checked={settings.snapToGrid}
            onChange={(snapToGrid) => update({ snapToGrid })}
          />
        }
      />


      <Row
        label="Auto-save"
        help="Keep the diagram you are editing in this browser, so it persists across a reload."
        control={
          <SelectControl
            label="Auto-save"
            value={settings.diagramAutoSave}
            onChange={(diagramAutoSave) => update({ diagramAutoSave })}
            options={[
              { value: 'off', label: 'Off' },
              { value: 'local', label: 'On (this browser)' },
            ]}
          />
        }
      />

      <Row
        label="Write to the opened file"
        help={
          supportsFileSystemAccess()
            ? 'Save edits straight back into the file you opened, with no download. Images are too slow to render on every edit, so they always wait for you to save.'
            : 'Unavailable: this browser has no file picker, so a page here can only put files in the downloads folder. Chrome, Edge, and other Chromium browsers on the desktop support it.'
        }
        control={
          <ToggleControl
            label="Write to the opened file"
            checked={settings.autoSaveToFile && supportsFileSystemAccess()}
            onChange={(autoSaveToFile) => update({ autoSaveToFile })}
            disabled={!supportsFileSystemAccess()}
          />
        }
      />
    </>
  );
}

function diagnosticsFor(prefix: string): string[] {
  return schemaDiagnostics().filter((diagnostic) => diagnostic.startsWith(`[${prefix} `) || diagnostic.startsWith(`[${prefix}]`));
}

function ExtensionsSection() {
  const { settings, update } = useSettings();
  const enabled = useMemo(() => new Set(settings.enabledSchemas), [settings.enabledSchemas]);
  const [initial] = useState(() => new Set(settings.enabledSchemas)); // what was enabled when the section opened
  const dirty = useMemo(() => {
    if (initial.size !== enabled.size) return true;
    for (const id of initial) if (!enabled.has(id)) return true;
    return false;
  }, [enabled, initial]);

  // A required schema's switch is disabled, and loadSchemas loads it whatever this list says.
  function toggle(prefix: string, on: boolean) {
    const next = new Set(enabled);
    if (on) next.add(prefix);
    else next.delete(prefix);
    update({ enabledSchemas: SCHEMAS.map((sc) => sc.prefix).filter((p) => next.has(p)) });
  }

  return (
    <>
      <SectionHeader
        title="Extensions"
        description="Which element sets the modeler loads. A disabled set leaves the palette and opened files."
      />

      {dirty && (
        <div className={`${s.group} sticky top-1 z-10`}>
          <p className={`${s.rowHelp} flex items-center gap-1.5`}>
            <i className={`${ICONS.arrowClockwise} text-sm`} aria-hidden="true" />
            Reload the page to apply changes.
            <button
              type="button"
              className={`ms-2 shrink-0 ${s.inlineBtn}`}
              onClick={() => window.location.reload()}
            >
              Reload now
            </button>
          </p>
        </div>
      )}

      {SCHEMA_LOAD_FAILURES.map((failure) => (
        <Row
          key={failure.sourceName}
          label={`${failure.sourceName} (not loaded)`}
          help={`Could not be read, so its elements are missing. Reload the page, and report this if it persists — ${failure.message}`}
          control={<i className="iconify bi--exclamation-triangle text-red-600" title="Failed to load" aria-label="Failed to load" />}
        />
      ))}

      {SCHEMAS.map((schema) => {
        const diagnostics = diagnosticsFor(schema.prefix);
        const help = schema.description;
        return (
          <Row
            key={schema.prefix}
            label={<>{schema.name}{schema.required && <i className={`${ICONS.lock} ms-1.5 text-xs text-stone-500`} role="img" title="required" aria-label="required" />}</>}
            help={diagnostics.length > 0 ? `${help} ⚠ ${diagnostics.join(' — ')}` : help}
            control={
              <ToggleControl
                label={`Load the ${schema.name} elements`}
                checked={schema.required || enabled.has(schema.prefix)}
                onChange={(on) => toggle(schema.prefix, on)}
                disabled={schema.required}
              />
            }
          />
        );
      })}

      {installedSchemas().map(({ skill, description, model }) => (
        <Row
          key={model.prefix}
          label={<>{model.name}<i className={`${ICONS.lock} ms-1.5 text-xs text-stone-500`} role="img" title="installed" aria-label="installed" /></>}
          help={`${model.description ?? description} Installed with \`studyflow skill add ${skill}\`, so it loads whenever the desktop app runs.`}
          control={<ToggleControl label={`Load the ${model.name} elements`} checked onChange={() => {}} disabled />}
        />
      ))}
    </>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function PrivacySection() {
  const { reset } = useSettings();
  const [estimate, setEstimate] = useState(() => getStorageEstimate());

  const storageHelp = useMemo(
    () => `${estimate.keys} key${estimate.keys === 1 ? '' : 's'}, ~${formatBytes(estimate.bytes)}`,
    [estimate],
  );

  return (
    <>
      <SectionHeader
        title="Privacy"
        description="What this app keeps stays in this browser, unless a skill's own page here says it sends it somewhere."
      />

      <Row
        label="Local storage"
        help={storageHelp}
        control={
          <button
            type="button"
            className={s.inlineBtnDanger}
            onClick={() => {
              if (window.confirm('Clear all local data, including settings and the saved studyflow? This cannot be undone.')) {
                clearAllLocalData();
                setEstimate(getStorageEstimate());
              }
            }}
          >
            Clear all local data
          </button>
        }
      />

      <Row
        label="Reset settings"
        help="Restore every setting on this page to its default. Your studyflow is untouched."
        control={
          <button type="button" className={s.inlineBtn} onClick={reset}>
            Reset to defaults
          </button>
        }
      />
    </>
  );
}

// A skill's pages (an account it signs in to) sit between the app's own and Privacy and About.
const SECTIONS: SettingsSection[] = [
  { id: 'editor', label: 'Editor', icon: 'bi--pencil', Component: EditorSection },
  { id: 'extensions', label: 'Extensions', icon: 'bi--diagram-3', Component: ExtensionsSection },
  ...SKILL_SETTINGS_SECTIONS,
  { id: 'privacy', label: 'Privacy', icon: 'bi--shield-lock', Component: PrivacySection },
  { id: 'about', label: 'About', icon: 'bi--info-circle', Component: AboutSection },
];

export function SettingsView({ onClose }: { onClose: () => void }) {
  const [active, setActive] = useState(SECTIONS[0].id);
  const ActiveSection = SECTIONS.find((sec) => sec.id === active)!.Component;

  return (
    <Modal isOpen onClose={onClose} title="Settings" size="xl" testId="settings-view">
      <div className={s.body}>
        <nav className={s.sidebar} aria-label="Settings sections">
          <ul className={s.sidebarList}>
            {SECTIONS.map((sec) => (
              <li key={sec.id}>
                <button
                  type="button"
                  onClick={() => setActive(sec.id)}
                  aria-current={active === sec.id ? 'page' : undefined}
                  className={`${s.sidebarItem} ${active === sec.id ? s.sidebarItemActive : ''}`}
                >
                  <i className={`iconify ${sec.icon} ${s.sidebarItemIcon}`} aria-hidden="true" />
                  <span>{sec.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <main className={s.content}>
          <div className={s.contentInner}>
            <ActiveSection />
          </div>
        </main>
      </div>
    </Modal>
  );
}
