import type { ComponentType } from 'react';

/** One page of Settings, a skill's among them: its entry in the sidebar, and what it shows. */
export type SettingsSection = {
  id: string;
  label: string;
  /** An iconify class (`bi--person-circle`), drawn beside the label. */
  icon: string;
  Component: ComponentType;
};
