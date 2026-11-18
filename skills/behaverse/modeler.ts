/** The behaverse skill's contribution to the modeler: its page of Settings (the account, and recording runs), "Save" to
 * the Behaverse server, and its tasks as a part of an experiment the New dialog lays out. */
import { ICONS } from '@modeler/icons';
import type { ModelerModule } from '@modeler/skillModules';
import { AccountSection } from '@skills/behaverse/modeler/AccountSection';
import { PublishPanel } from '@skills/behaverse/modeler/PublishPanel';

const module: ModelerModule = {
  settings: [{ id: 'behaverse', label: 'Behaverse', icon: 'tabler--user-circle', Component: AccountSection }],
  destinations: [{ id: 'cloud', label: 'Cloud', icon: ICONS.cloudUpload, hint: 'Upload to the Behaverse server', Panel: PublishPanel }],
  starters: [{ label: 'Behaverse tasks', intent: 'experiment', order: 50, steps: [{ extension: 'behaverse:Task', name: 'Behaverse task' }] }],
};

export default module;
