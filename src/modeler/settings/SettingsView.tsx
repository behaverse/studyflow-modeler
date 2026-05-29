import { useEffect, useMemo, useState } from 'react';
import { Switch } from '@headlessui/react';
import { SCHEMAS, URLS } from '../constants';
import { settingsView as s } from '../styles';
import { useSettings } from './useSettings';
import { useApiKey } from './useApiKey';
import {
  clearAllLocalData,
  getStorageEstimate,
  getStoredUserEmail,
  setStoredUserEmail,
} from './store';

type SectionId = 'account' | 'general' | 'editor' | 'data-server' | 'extensions' | 'privacy' | 'about';

type Section = {
  id: SectionId;
  label: string;
  icon: string;
};

const SECTIONS: Section[] = [
  { id: 'account', label: 'Account', icon: 'bi--person-circle' },
  { id: 'general', label: 'General', icon: 'bi--sliders' },
  { id: 'editor', label: 'Editor', icon: 'bi--pencil' },
  // Hidden for now — uncomment to expose the Data server settings tab again.
  // { id: 'data-server', label: 'Data server', icon: 'bi--hdd-network' },
  { id: 'extensions', label: 'Extensions', icon: 'bi--diagram-3' },
  { id: 'privacy', label: 'Privacy', icon: 'bi--shield-lock' },
  { id: 'about', label: 'About', icon: 'bi--info-circle' },
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
      <div className={s.panel}>
        <header className={s.header}>
          <button
            type="button"
            onClick={onClose}
            aria-label="Back"
            title="Back (Esc)"
            className={s.backButton}
          >
            <i className={s.backIcon} aria-hidden="true" />
          </button>
          <h1 className={s.headerTitle}>Settings</h1>
        </header>

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
            {/* <p className={s.sidebarFooter}>Stored locally on this browser.</p> */}
          </nav>

          <main className={s.content}>
            <div className={s.contentInner}>
              {active === 'account' && <AccountSection />}
              {active === 'general' && <GeneralSection />}
              {active === 'editor' && <EditorSection />}
              {active === 'data-server' && <DataServerSection />}
              {active === 'extensions' && <ExtensionsSection />}
              {active === 'privacy' && <PrivacySection />}
              {active === 'about' && <AboutSection />}
            </div>
          </main>
        </div>
      </div>
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
  help?: React.ReactNode;
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

const GOOGLE_LOGIN_URL = `${URLS.apiBase}/v1/auth/google/login`;
const API_BASE_ORIGIN = (() => {
  try {
    return new URL(URLS.apiBase).origin;
  } catch {
    return '';
  }
})();

function AccountSection() {
  const { apiKey, setApiKey } = useApiKey();
  const isGuest = apiKey === 'guest';
  const [revealKey, setRevealKey] = useState(false);
  const [loginError, setLoginError] = useState<string | undefined>();
  const [loginPending, setLoginPending] = useState(false);
  const [email, setEmail] = useState<string | undefined>(() => getStoredUserEmail());

  useEffect(() => {
    if (isGuest) setEmail(undefined);
  }, [isGuest]);

  function loginWithGoogle() {
    setLoginError(undefined);
    setLoginPending(true);

    const w = 480;
    const h = 640;
    const left = window.screenX + (window.outerWidth - w) / 2;
    const top = window.screenY + (window.outerHeight - h) / 2;
    const popup = window.open(
      GOOGLE_LOGIN_URL,
      'behaverse-login',
      `width=${w},height=${h},left=${left},top=${top},popup=yes`,
    );

    if (!popup) {
      setLoginPending(false);
      setLoginError('Popup blocked. Allow popups and try again.');
      return;
    }

    const onMessage = (e: MessageEvent) => {
      if (API_BASE_ORIGIN && e.origin !== API_BASE_ORIGIN) return;
      const data = e.data as { type?: string; api_key?: string; email?: string } | null;
      if (!data || data.type !== 'behaverse:login' || !data.api_key) return;
      window.removeEventListener('message', onMessage);
      clearInterval(closedTimer);
      setApiKey(data.api_key);
      if (data.email) {
        setEmail(data.email);
        setStoredUserEmail(data.email);
      }
      setLoginPending(false);
      try { popup.close(); } catch { /* ignore */ }
    };

    const closedTimer = setInterval(() => {
      if (popup.closed) {
        clearInterval(closedTimer);
        window.removeEventListener('message', onMessage);
        setLoginPending(false);
      }
    }, 500);

    window.addEventListener('message', onMessage);
  }

  function signOut() {
    setApiKey('guest');
    setStoredUserEmail(undefined);
    setEmail(undefined);
    setRevealKey(false);
  }

  return (
    <>
      <SectionHeader title="Account" />

      <Row
        label="Status"
        help={
          isGuest
            ? 'You are working as a guest. Diagrams stay on this device.'
            : email
              ? <>Signed in as <strong className="font-semibold text-stone-900">{email}</strong></>
              : 'Signed in.'
        }
        control={
          <div className="flex flex-col items-end gap-1">
            {isGuest ? (
              <button
                type="button"
                className={`${s.inlineBtn} inline-flex items-center gap-2`}
                disabled={loginPending}
                onClick={loginWithGoogle}
              >
                <i className="iconify bi--google" aria-hidden="true" />
                <span>{loginPending ? 'Waiting for Google...' : 'Login with Google'}</span>
              </button>
            ) : (
              <button
                type="button"
                className={s.inlineBtn}
                onClick={signOut}
                title="Clears the saved API key and returns to guest mode"
              >
                Sign out
              </button>
            )}
            {isGuest && loginError && <p className="text-[12px] text-red-700">{loginError}</p>}
          </div>
        }
      />

      {!isGuest && (
        <Row
          label="API key"
          help="Stored locally on this browser. Keep your key secret, anyone with this key can act as you."
          control={
            <div className="relative inline-block">
              <input
                id="api-key-input"
                type={revealKey ? 'text' : 'password'}
                value={apiKey}
                readOnly
                className={`${s.textInput} pr-9`}
              />
              <button
                type="button"
                aria-controls="api-key-input"
                aria-pressed={revealKey}
                onClick={() => setRevealKey((v) => !v)}
                title={revealKey ? 'Hide key' : 'Show key'}
                className="absolute inset-y-0 right-0 flex items-center justify-center w-9 text-stone-500 hover:text-stone-900 cursor-pointer"
              >
                <i className={`iconify ${revealKey ? 'bi--eye-slash' : 'bi--eye'}`} aria-hidden="true" />
              </button>
            </div>
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

function DataServerSection() {
  const { settings, update } = useSettings();
  const { apiKey } = useApiKey();
  const hasServer = Boolean(settings.dataServerUrl && settings.studyName);
  const signedIn = apiKey !== 'guest';
  const statusIcon = !hasServer ? 'bi--cloud-slash' : signedIn ? 'bi--cloud-check' : 'bi--exclamation-triangle';

  return (
    <>
      <SectionHeader
        title="Data server"
        description="Where runs launched with “Run” persist sessions and telemetry events. Requests are authenticated with your account API key (set it on the Account page). Leave the URL or study name empty to run offline — no session is created and nothing is sent."
      />

      <Row
        label="Server URL"
        help="Base URL of the Behaverse data-server, including the API version."
        control={
          <input
            type="text"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            aria-label="Data-server URL"
            value={settings.dataServerUrl}
            onChange={(e) => update({ dataServerUrl: e.target.value.trim() })}
            placeholder="https://data.behaverse.org/v1"
            className={s.textInput}
          />
        }
      />

      <Row
        label="Study name"
        help="Sessions and events are written under this study."
        control={
          <input
            type="text"
            autoComplete="off"
            spellCheck={false}
            aria-label="Study name"
            value={settings.studyName}
            onChange={(e) => update({ studyName: e.target.value.trim() })}
            placeholder="my-study"
            className={s.textInput}
          />
        }
      />

      <div className={s.group}>
        <p className={s.rowHelp}>
          <i className={`iconify ${statusIcon} pe-1.5`} aria-hidden="true" />
          {!hasServer
            ? 'Runs are offline. Set both a server URL and a study name to persist data.'
            : signedIn
              ? 'Runs will create a session and post events to the data-server.'
              : 'Runs will create a session, but posting events needs your account API key — sign in on the Account page.'}
        </p>
      </div>
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
        help={`${estimate.keys} key${estimate.keys === 1 ? '' : 's'}, ~${formatBytes(estimate.bytes)}`}
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
