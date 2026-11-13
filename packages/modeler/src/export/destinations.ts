import type { ComponentType } from 'react';

/**
 * A place a skill adds for "Save" to send the study, other than this machine (a server it publishes to). It has a
 * button beside Local and a panel, shown when it is picked, which asks what it needs and sends the study itself.
 */
export type SaveDestination = {
  id: string;
  label: string;
  /** An iconify class, with its `iconify` prefix. */
  icon: string;
  hint: string;
  Panel: ComponentType<{ onClose: () => void }>;
};
