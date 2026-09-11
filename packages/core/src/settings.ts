/** The settings both apps read: the account key, and whether runs report events. */
import { STORAGE_KEYS, persisted, stringCodec } from '@core/storage';

const apiKeyStore = persisted<string>(STORAGE_KEYS.apiKey, stringCodec, '');

export function getApiKey(): string | undefined {
  return apiKeyStore.peek();
}

const recordEventsStore = persisted<string>(STORAGE_KEYS.recordEvents, stringCodec, '');

export function shouldRecordEvents(): boolean {
  return recordEventsStore.peek() === '1';
}

export function setRecordEvents(enabled: boolean): void {
  if (enabled) recordEventsStore.save('1');
  else recordEventsStore.clear();
}
