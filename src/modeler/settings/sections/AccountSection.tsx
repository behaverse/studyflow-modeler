import { useEffect, useState } from 'react';
import { URLS } from '../../constants';
import { settingsView as s } from '../../styles';
import { useApiKey } from '../useApiKey';
import { getStoredUserEmail, setStoredUserEmail } from '../store';
import { Row, SectionHeader } from './controls';
import { ICONS } from '@/icons';

const GOOGLE_LOGIN_URL = `${URLS.apiBase}/v1/auth/google/login`;
const API_BASE_ORIGIN = (() => {
  try {
    return new URL(URLS.apiBase).origin;
  } catch {
    return '';
  }
})();

export function AccountSection() {
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
