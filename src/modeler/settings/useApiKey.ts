import { useCallback, useEffect, useState } from 'react';
import { getStoredApiKey, setStoredApiKey } from './store';

const GUEST = 'guest';

/** Reactive API key backed by localStorage; cross-tab sync via the `storage` event. */
export function useApiKey(): {
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
