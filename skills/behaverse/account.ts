/** The Behaverse account both apps read: the servers, the key the sign-in hands back, and whether runs are recorded. */
import { persisted, storageKey, stringCodec } from '@core/storage';

/** The account server: sign-in, and publishing a study. */
export const API_BASE = 'https://api.behaverse.org';
export const API_DOCS = `${API_BASE}/docs`;

const apiKeyStore = persisted<string>(storageKey('api-key'), stringCodec, '');

export function getApiKey(): string | undefined {
  return apiKeyStore.peek();
}

export function setApiKey(key: string | undefined | null): void {
  if (!key) apiKeyStore.clear();
  else apiKeyStore.save(key);
}

const recordEventsStore = persisted<string>(storageKey('record-events'), stringCodec, '');

export function shouldRecordEvents(): boolean {
  return recordEventsStore.peek() === '1';
}

export function setRecordEvents(enabled: boolean): void {
  if (enabled) recordEventsStore.save('1');
  else recordEventsStore.clear();
}
