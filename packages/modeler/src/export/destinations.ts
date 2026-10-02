import type { ComponentType } from 'react';

/**
 * A place "Save" sends the study other than this machine, a skill's (a server it publishes to): its button beside
 * Local, and the panel shown when it is picked, which asks what it needs and sends the study itself.
 */
export type SaveDestination = {
  id: string;
  label: string;
  /** An iconify class, with its `iconify` prefix. */
  icon: string;
  hint: string;
  Panel: ComponentType<{ onClose: () => void }>;
};
