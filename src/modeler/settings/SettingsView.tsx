import { useContext, useEffect, useMemo, useState } from 'react';
import { Switch } from '@headlessui/react';
import { APIKeyContext } from '../contexts';
import { SCHEMAS, URLS } from '../constants';
import { settingsView as s } from '../styles';
import { useSettings } from './useSettings';
import { clearAllLocalData, getStorageEstimate } from './store';

type SectionId = 'account' | 'general' | 'editor' | 'extensions' | 'privacy' | 'about';

type Section = {
  id: SectionId;
  label: string;
  icon: string;
  group: 'user' | 'app';
};

const SECTIONS: Section[] = [
  { id: 'account', label: 'Account', icon: 'bi--person-circle', group: 'user' },
  { id: 'general', label: 'General', icon: 'bi--sliders', group: 'app' },
  { id: 'editor', label: 'Editor', icon: 'bi--pencil', group: 'app' },
  { id: 'extensions', label: 'Extensions', icon: 'bi--diagram-3', group: 'app' },
  { id: 'privacy', label: 'Privacy', icon: 'bi--shield-lock', group: 'app' },
  { id: 'about', label: 'About', icon: 'bi--info-circle', group: 'app' },
];

export function SettingsView({ onClose }: { onClose: () => void }) {
  const [active, setActive] = useState<SectionId>('account');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className={s.root} role="dialog" aria-modal="true" aria-label="Settings" data-testid="settings-view">
      <header className={s.header}>
        <h1 className={s.headerTitle}>Settings</h1>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close settings"
          title="Close settings (Esc)"
          className={s.closeButton}
        >
          <i className={s.closeIcon} aria-hidden="true" />
        </button>
      </header>

      <div className={s.body}>
        <nav className={s.sidebar} aria-label="Settings sections">
          <SidebarGroup
            label="User"
            sections={SECTIONS.filter((sec) => sec.group === 'user')}
            active={active}
            onSelect={setActive}
          />
          <SidebarGroup
            label="Application"
            sections={SECTIONS.filter((sec) => sec.group === 'app')}
            active={active}
            onSelect={setActive}
          />
          <p className={s.sidebarFooter}>
            Stored locally on this browser.
          </p>
        </nav>

        <main className={s.content}>
          <div className={s.contentInner}>
            {active === 'account' && <AccountSection />}
            {active === 'general' && <GeneralSection />}
            {active === 'editor' && <EditorSection />}
            {active === 'extensions' && <ExtensionsSection />}
            {active === 'privacy' && <PrivacySection />}
            {active === 'about' && <AboutSection />}
          </div>
        </main>
      </div>
    </div>
  );
}

function SidebarGroup({
  label,
  sections,
  active,
  onSelect,
}: {
  label: string;
  sections: Section[];
  active: SectionId;
  onSelect: (id: SectionId) => void;
}) {
  return (
    <div className="mb-2">
      <p className={s.sidebarGroupLabel}>{label}</p>
      <ul className="space-y-0.5">
        {sections.map((sec) => (
          <li key={sec.id}>
            <button
              type="button"
              onClick={() => onSelect(sec.id)}
              aria-current={active === sec.id ? 'page' : undefined}
              className={`${s.sidebarItem} ${active === sec.id ? s.sidebarItemActive : ''}`}
            >
              <i className={`iconify ${sec.icon} ${s.sidebarItemIcon}`} aria-hidden="true" />
              <span>{sec.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div>
      <h2 className={s.sectionTitle}>{title}</h2>
      {description && <p className={s.sectionDescription}>{description}</p>}
    </div>
  );
}

function Row({
  label,
  help,
  control,
}: {
  label: string;
  help?: string;
  control: React.ReactNode;
}) {
  return (
    <div className={s.row}>
      <div className={s.rowText}>
        <div className={s.rowLabel}>{label}</div>
        {help && <p className={s.rowHelp}>{help}</p>}
      </div>
      <div className={s.rowControl}>{control}</div>
    </div>
  );
}

function ToggleControl({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <Switch
      checked={checked}
      onChange={onChange}
      disabled={disabled}
      aria-label={label}
      className={`group ${s.switchTrack} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      <span aria-hidden="true" className={s.switchThumb} />
    </Switch>
  );
}

function SelectControl<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (next: T) => void;
  label: string;
}) {
  return (
    <div className={s.selectWrapper}>
      <select
        value={value}
        aria-label={label}
        onChange={(e) => onChange(e.target.value as T)}
        className={s.select}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <i className={s.selectChevron} aria-hidden="true" />
    </div>
  );
}

// --- Sections

function AccountSection() {
  const { apiKey, setApiKey } = useContext(APIKeyContext);
  const isGuest = !apiKey || apiKey === 'guest';
  const [draftKey, setDraftKey] = useState('');

  return (
    <>
      <SectionHeader
        title="Account"
        description="Sign in with a Behaverse API key to publish and sync diagrams. Local-only mode is available without a key."
      />

      <Row
        label="Status"
        help={isGuest ? 'You are working as a guest. Diagrams stay on this device.' : 'Signed in.'}
        control={
          <span className={s.valueChip}>
            <i className={`iconify ${isGuest ? 'bi--person' : 'bi--person-check-fill'} text-[12px]`} aria-hidden="true" />
            {isGuest ? 'Guest' : 'Signed in'}
          </span>
        }
      />

      <Row
        label="Behaverse API key"
        help="Stored in this browser only. Replace it any time to switch accounts."
        control={
          <div className="flex gap-2">
            <input
              type="password"
              value={draftKey}
              onChange={(e) => setDraftKey(e.target.value)}
              placeholder={isGuest ? 'Paste your key' : '••••••••'}
              className={s.textInput}
              autoComplete="off"
            />
            <button
              type="button"
              className={s.inlineBtn}
              disabled={draftKey.trim() === ''}
              onClick={() => {
                if (!draftKey.trim()) return;
                setApiKey(draftKey.trim());
                setDraftKey('');
              }}
            >
              Save
            </button>
          </div>
        }
      />

      {!isGuest && (
        <Row
          label="Sign out"
          help="Clears the saved API key and returns to guest mode."
          control={
            <button
              type="button"
              className={s.inlineBtn}
              onClick={() => setApiKey('guest')}
            >
              Sign out
            </button>
          }
        />
      )}
    </>
  );
}

function GeneralSection() {
  const { settings, update } = useSettings();

  return (
    <>
      <SectionHeader title="General" description="Appearance and language preferences." />

      <Row
        label="Theme"
        help=""
        control={
          <SelectControl
            label="Theme"
            value={settings.theme}
            onChange={(theme) => update({ theme })}
            options={[
              { value: 'light', label: 'Light' },
            ]}
          />
        }
      />

      <Row
        label="Language"
        help=""
        control={
          <SelectControl
            label="Language"
            value={settings.language}
            onChange={(language) => update({ language })}
            options={[{ value: 'en', label: 'English' }]}
          />
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
        label="Show grid"
        help="Render a faint background grid on the canvas."
        control={
          <ToggleControl
            label="Show grid"
            checked={settings.showGrid}
            onChange={(showGrid) => update({ showGrid })}
          />
        }
      />

      <Row
        label="Open inspector by default"
        help="When you load a diagram, expand the inspector panel automatically."
        control={
          <ToggleControl
            label="Open inspector by default"
            checked={settings.inspectorDefaultOpen}
            onChange={(inspectorDefaultOpen) => update({ inspectorDefaultOpen })}
          />
        }
      />

      <Row
        label="Auto-save diagram"
        help="Save the current diagram to this browser as you edit, so it persists across reloads."
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
    </>
  );
}

function ExtensionsSection() {
  const { settings, update } = useSettings();
  const enabled = useMemo(() => new Set(settings.enabledSchemas), [settings.enabledSchemas]);
  const initial = useMemo(() => new Set(settings.enabledSchemas), []);
  const dirty = useMemo(() => {
    if (initial.size !== enabled.size) return true;
    for (const id of initial) if (!enabled.has(id)) return true;
    return false;
  }, [enabled, initial]);

  function toggle(prefix: string, on: boolean) {
    const schema = SCHEMAS.find((sc) => sc.prefix === prefix);
    if (schema?.core && !on) return; // core schemas can't be disabled
    const next = new Set(enabled);
    if (on) next.add(prefix);
    else next.delete(prefix);
    for (const sc of SCHEMAS) if (sc.core) next.add(sc.prefix); // core always included
    update({ enabledSchemas: SCHEMAS.map((sc) => sc.prefix).filter((p) => next.has(p)) });
  }

  return (
    <>
      <SectionHeader
        title="Extensions"
        description="Choose which extension the modeler loads. Disabled schemas are excluded from the palette and won't be recognized when opening diagrams."
      />

      {dirty && (
        <div className={s.group}>
          <p className={s.rowHelp}>
            <i className="iconify bi--arrow-clockwise pe-1.5" /> Reload the page to apply changes.
            <button
              type="button"
              className={`ms-2 ${s.inlineBtn}`}
              onClick={() => window.location.reload()}
            >
              Reload now
            </button>
          </p>
        </div>
      )}

      {SCHEMAS.map((schema) => (
        <Row
          key={schema.prefix}
          label={schema.core ? `${schema.name} (core)` : schema.name}
          help={schema.core ? `${schema.description} Core schemas cannot be disabled.` : schema.description}
          control={
            <ToggleControl
              label={`Enable ${schema.name} schema`}
              checked={schema.core || enabled.has(schema.prefix)}
              onChange={(on) => toggle(schema.prefix, on)}
              disabled={schema.core}
            />
          }
        />
      ))}
    </>
  );
}

function PrivacySection() {
  const { settings, update, reset } = useSettings();
  const estimate = useMemo(() => getStorageEstimate(), []);

  return (
    <>
      <SectionHeader
        title="Privacy"
        description="Everything is stored in your browser, and nothing leaves this device unless you sign in and publish."
      />

      <Row
        label="Anonymous telemetry"
        help="Send anonymous error and usage data to help improve the modeler. Off by default."
        control={
          <ToggleControl
            label="Anonymous telemetry"
            checked={settings.telemetryEnabled}
            onChange={(telemetryEnabled) => update({ telemetryEnabled })}
          />
        }
      />

      <Row
        label="Local storage"
        help={`${estimate.keys} key${estimate.keys === 1 ? '' : 's'} • ~${formatBytes(estimate.bytes)}`}
        control={
          <button
            type="button"
            className={s.inlineBtnDanger}
            onClick={() => {
              if (window.confirm('Clear all local data including settings and saved diagrams? This cannot be undone.')) {
                clearAllLocalData();
              }
            }}
          >
            Clear all local data
          </button>
        }
      />

      <Row
        label="Reset settings"
        help="Restore every setting on this page to its default. Saved diagrams are not affected."
        control={
          <button type="button" className={s.inlineBtn} onClick={reset}>
            Reset to defaults
          </button>
        }
      />
    </>
  );
}

function AboutSection() {
  const version = (import.meta as any).env?.APP_VERSION ?? 'dev';
  return (
    <>
      <SectionHeader title="About" description="Studyflow Modeler is an authoring tool for scientific research workflows." />

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

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
