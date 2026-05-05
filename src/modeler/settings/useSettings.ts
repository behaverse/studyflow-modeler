import { useSyncExternalStore } from 'react';
import {
  getSettings,
  setSettings,
  subscribeSettings,
  resetSettings,
  type Settings,
} from './store';

export function useSettings(): {
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
