import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { SCHEMAS, SCHEMA_LOAD_FAILURES } from '@behaverse/studyflow-core/notation/loader';
import { schemaDiagnostics } from '@behaverse/studyflow-core/notation';
import { setRecordEvents, shouldRecordEvents } from '@behaverse/studyflow-core/settings';
import { ICONS } from '@/icons';
import { URLS } from '@/modeler/constants';
import {
  clearAllLocalData,
  getSettings,
  getStorageEstimate,
  getStoredApiKey,
  getStoredUserEmail,
  resetSettings,
  setSettings,
  setStoredApiKey,
  setStoredUserEmail,
  subscribeSettings,
  type Settings,
} from '@/modeler/settings/store';
import { Row, SectionHeader, SelectControl, ToggleControl } from '@/modeler/settings/controls';
import { settingsView as s } from '@/modeler/settings/styles';

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

const GUEST = 'guest';

function useApiKey(): {
  apiKey: string;
  setApiKey: (key: string | null | undefined) => void;
} {
  const [apiKey, setApiKeyState] = useState<string>(() => getStoredApiKey() ?? GUEST);

  useEffect(() => {
    const onStorage = () => setApiKeyState(getStoredApiKey() ?? GUEST);
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const setApiKey = useCallback((key: string | null | undefined) => {
    setStoredApiKey(key);
    setApiKeyState(key && key !== GUEST ? key : GUEST);
  }, []);

  return { apiKey, setApiKey };
}

const GOOGLE_LOGIN_URL = `${URLS.apiBase}/v1/auth/google/login`;

/** Origin the login popup must post from; `undefined` (non-absolute `apiBase`) must fail the login closed. */
const API_BASE_ORIGIN: string | undefined = (() => {
  try {
    return new URL(URLS.apiBase).origin;
  } catch {
    return undefined;
  }
})();

function AccountSection() {
  const { apiKey, setApiKey } = useApiKey();
  const isGuest = apiKey === 'guest';
  const [revealKey, setRevealKey] = useState(false);
  const [loginError, setLoginError] = useState<string | undefined>();
  const [loginPending, setLoginPending] = useState(false);
  const [storedEmail, setStoredEmail] = useState<string | undefined>(() => getStoredUserEmail());
  const email = isGuest ? undefined : storedEmail;
  const setEmail = setStoredEmail;

  function loginWithGoogle() {
    if (!API_BASE_ORIGIN) {
      setLoginError('Sign-in is unavailable: the API base URL is not configured as an absolute URL.');
      return;
    }
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
      if (e.origin !== API_BASE_ORIGIN) return;
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
                <i className={ICONS.google} aria-hidden="true" />
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

function diagnosticsFor(prefix: string): string[] {
  return schemaDiagnostics().filter((diagnostic) => diagnostic.startsWith(`[${prefix} `) || diagnostic.startsWith(`[${prefix}]`));
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
            <i className={`${ICONS.arrowClockwise} pe-1.5`} /> Reload the page to apply changes.
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

      {SCHEMA_LOAD_FAILURES.map((failure) => (
        <Row
          key={failure.sourceName}
          label={`${failure.sourceName} (not loaded)`}
          help={`This schema file failed to parse and was skipped: ${failure.message}`}
          control={<i className="iconify bi--exclamation-triangle text-red-600" title="Failed to load" aria-label="Failed to load" />}
        />
      ))}

      {SCHEMAS.map((schema) => {
        const diagnostics = diagnosticsFor(schema.prefix);
        const help = schema.core ? `${schema.description} Core schemas cannot be disabled.` : schema.description;
        return (
          <Row
            key={schema.prefix}
            label={schema.core ? `${schema.name} (core)` : schema.name}
            help={diagnostics.length > 0 ? `${help} ⚠ ${diagnostics.join(' — ')}` : help}
            control={
              <ToggleControl
                label={`Enable ${schema.name} schema`}
                checked={schema.core || enabled.has(schema.prefix)}
                onChange={(on) => toggle(schema.prefix, on)}
                disabled={schema.core}
              />
            }
          />
        );
      })}
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
  /** The runner's own "Record events" toggle drives this same `core/settings` key. */
  const [recording, setRecording] = useState(() => shouldRecordEvents());

  const storageHelp = useMemo(
    () => `${estimate.keys} key${estimate.keys === 1 ? '' : 's'}, ~${formatBytes(estimate.bytes)}`,
    [estimate],
  );

  return (
    <>
      <SectionHeader
        title="Privacy"
        description="Everything is stored in your browser, and nothing leaves this device unless you sign in and publish."
      />

      <Row
        label="Record run data"
        help="When a studyflow runs, send its session, variables, and task events to the configured data server. Off by default; the runner has the same switch."
        control={
          <ToggleControl
            label="Record run data"
            checked={recording}
            onChange={(next) => {
              setRecordEvents(next);
              setRecording(shouldRecordEvents());
            }}
          />
        }
      />

      <Row
        label="Local storage"
        help={storageHelp}
        control={
          <button
            type="button"
            className={s.inlineBtnDanger}
            onClick={() => {
              if (window.confirm('Clear all local data including settings and saved diagrams? This cannot be undone.')) {
                clearAllLocalData();
                setRecording(shouldRecordEvents());
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

type SectionId = 'account' | 'editor' | 'extensions' | 'privacy' | 'about';

type Section = {
  id: SectionId;
  label: string;
  icon: string;
  Component: () => React.ReactNode;
};

const SECTIONS: Section[] = [
  { id: 'account', label: 'Account', icon: 'bi--person-circle', Component: AccountSection },
  { id: 'editor', label: 'Editor', icon: 'bi--pencil', Component: EditorSection },
  { id: 'extensions', label: 'Extensions', icon: 'bi--diagram-3', Component: ExtensionsSection },
  { id: 'privacy', label: 'Privacy', icon: 'bi--shield-lock', Component: PrivacySection },
  { id: 'about', label: 'About', icon: 'bi--info-circle', Component: AboutSection },
];

export function SettingsView({ onClose }: { onClose: () => void }) {
  const [active, setActive] = useState<SectionId>('account');
  const ActiveSection = SECTIONS.find((sec) => sec.id === active)!.Component;

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
          </nav>

          <main className={s.content}>
            <div className={s.contentInner}>
              <ActiveSection />
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
