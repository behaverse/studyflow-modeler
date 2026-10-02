import { useCallback, useEffect, useState } from 'react';
import { ICONS } from '@modeler/icons';
import { Row, SectionHeader, ToggleControl } from '@modeler/settings/controls';
import { getStoredUserEmail, setStoredUserEmail } from '@modeler/settings/store';
import { settingsView as s } from '@modeler/settings/styles';
import { API_BASE, getApiKey, setApiKey, setRecordEvents, shouldRecordEvents } from '@skills/behaverse/account';

/** The Behaverse page of Settings: the account a Google sign-in opens, its key, and whether runs are recorded. */

const GUEST = 'guest';

function useApiKey(): {
  apiKey: string;
  setApiKey: (key: string | null | undefined) => void;
} {
  const [apiKey, setApiKeyState] = useState<string>(() => getApiKey() ?? GUEST);

  useEffect(() => {
    const onStorage = () => setApiKeyState(getApiKey() ?? GUEST);
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const setKey = useCallback((key: string | null | undefined) => {
    setApiKey(key);
    setApiKeyState(key || GUEST);
  }, []);

  return { apiKey, setApiKey: setKey };
}

const GOOGLE_LOGIN_URL = `${API_BASE}/v1/auth/google/login`;

/** Origin the login popup must post from; `undefined` (non-absolute `API_BASE`) must fail the login closed. */
const API_BASE_ORIGIN: string | undefined = (() => {
  try {
    return new URL(API_BASE).origin;
  } catch {
    return undefined;
  }
})();

export function AccountSection() {
  const { apiKey, setApiKey } = useApiKey();
  const isGuest = apiKey === GUEST;
  const [revealKey, setRevealKey] = useState(false);
  const [loginError, setLoginError] = useState<string | undefined>();
  const [loginPending, setLoginPending] = useState(false);
  const [storedEmail, setStoredEmail] = useState<string | undefined>(() => getStoredUserEmail());
  const [recording, setRecording] = useState(() => shouldRecordEvents());
  const email = isGuest ? undefined : storedEmail;
  const setEmail = setStoredEmail;

  function loginWithGoogle() {
    if (!API_BASE_ORIGIN) {
      setLoginError('Sign-in is unavailable: this build has no server address. Keep working as a guest.');
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
      setLoginError('The browser blocked the Google sign-in window. Allow pop-ups for this site and try again.');
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
    setApiKey(null);
    setStoredUserEmail(undefined);
    setEmail(undefined);
    setRevealKey(false);
  }

  return (
    <>
      <SectionHeader title="Behaverse" description="Sign in to publish studyflows to the Behaverse server, and record runs on its data server." />

      <Row
        label="Status"
        help={
          isGuest
            ? 'You are working as a guest. Studyflows stay on this device.'
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
            {isGuest && loginError && <p className="text-xs text-red-700">{loginError}</p>}
          </div>
        }
      />

      {!isGuest && (
        <Row
          label="API key"
          help="Stored in this browser only. Keep it secret, anyone holding it can act as you."
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

      <Row
        label="Record run data"
        help="Send each run's session, variables and task events to the Behaverse Data Server. Off by default; the browser runner's own switch is this one."
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
    </>
  );
}
