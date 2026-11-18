import { useMemo, useState, useSyncExternalStore } from 'react';
import { Modal } from '@modeler/ui/Modal';
import { SCHEMAS, SCHEMA_LOAD_FAILURES } from '@core/notation/loader';
import { installedSchemas } from '@modeler/app/installedSchemas';
import { loadedSchemas, turnOnSchemas, useCatalogVersion } from '@modeler/app/skills';
import { notify } from '@modeler/app/noticeStore';
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
      <SectionHeader title="About" />

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
      <SectionHeader title="Editor" />

      <Row
        label="Snap to grid"
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
        help={supportsFileSystemAccess() ? undefined : 'Needs Chrome or Edge.'}
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
  const disabled = useMemo(() => new Set(settings.disabledSchemas), [settings.disabledSchemas]);
  // A set turned on loads now; one turned off stays loaded until a reload, since reading the study without it would
  // drop its elements.
  const catalog = useCatalogVersion();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `catalog` stands in for what is loaded
  const leaving = useMemo(() => loadedSchemas().filter((prefix) => disabled.has(prefix)), [disabled, catalog]);
  const [turningOn, setTurningOn] = useState<string>();

  // A required schema's switch is disabled, and it is never stored as off.
  function toggle(prefix: string, on: boolean) {
    const next = new Set(disabled);
    if (on) next.delete(prefix);
    else next.add(prefix);
    update({ disabledSchemas: SCHEMAS.filter((sc) => !sc.required && next.has(sc.prefix)).map((sc) => sc.prefix) });
    if (!on) return;
    setTurningOn(prefix);
    turnOnSchemas([prefix])
      .catch((err) => notify('error', `Could not load it: ${err instanceof Error ? err.message : String(err)}`))
      .finally(() => setTurningOn(undefined));
  }

  return (
    <>
      <SectionHeader title="Extensions" />

      {leaving.length > 0 && (
        <div className={`${s.group} sticky top-1 z-10`}>
          <p className={`${s.rowHelp} flex items-center gap-1.5`}>
            <i className={`${ICONS.reload} text-sm`} aria-hidden="true" />
            Turned off after a reload.
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
          help={`Couldn't be read: ${failure.message}`}
          control={<i className={`${ICONS.warning} text-red-600`} title="Failed to load" aria-label="Failed to load" />}
        />
      ))}

      {SCHEMAS.map((schema) => {
        const diagnostics = diagnosticsFor(schema.prefix);
        const help = schema.description;
        return (
          <Row
            key={schema.prefix}
            label={<span title={help}>{schema.name}{schema.required && <i className={`${ICONS.lock} ms-1.5 text-xs text-stone-500`} role="img" title="required" aria-label="required" />}</span>}
            help={diagnostics.length > 0 ? `⚠ ${diagnostics.join('; ')}` : undefined}
            control={
              <ToggleControl
                label={`Load the ${schema.name} elements`}
                checked={schema.required || !disabled.has(schema.prefix)}
                onChange={(on) => toggle(schema.prefix, on)}
                disabled={schema.required || turningOn !== undefined}
              />
            }
          />
        );
      })}

      {installedSchemas().map(({ skill, model }) => (
        <Row
          key={model.prefix}
          label={<>{model.name}<i className={`${ICONS.lock} ms-1.5 text-xs text-stone-500`} role="img" title="installed" aria-label="installed" /></>}
          help={`studyflow skill add ${skill}`}
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
      <SectionHeader title="Privacy" />

      <Row
        label="Local storage"
        help={storageHelp}
        control={
          <button
            type="button"
            className={s.inlineBtnDanger}
            onClick={() => {
              if (window.confirm('Clear all local data, including settings and the saved study? This cannot be undone.')) {
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
  { id: 'editor', label: 'Editor', icon: 'tabler--pencil', Component: EditorSection },
  { id: 'extensions', label: 'Extensions', icon: 'lucide--blocks', Component: ExtensionsSection },
  ...SKILL_SETTINGS_SECTIONS,
  { id: 'privacy', label: 'Privacy', icon: 'tabler--shield-check', Component: PrivacySection },
  { id: 'about', label: 'About', icon: 'tabler--info-circle', Component: AboutSection },
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
