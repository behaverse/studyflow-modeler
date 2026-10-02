/** What the behaverse skill gives the modeler: its page of Settings (the account, and recording runs) and "Save" to
 * the Behaverse server. */
import { ICONS } from '@modeler/icons';
import type { ModelerModule } from '@modeler/skillModules';
import { AccountSection } from '@skills/behaverse/modeler/AccountSection';
import { PublishPanel } from '@skills/behaverse/modeler/PublishPanel';

const module: ModelerModule = {
  settings: [{ id: 'behaverse', label: 'Behaverse', icon: 'bi--person-circle', Component: AccountSection }],
  destinations: [{ id: 'cloud', label: 'Cloud', icon: ICONS.broadcast, hint: 'Upload to the Behaverse server', Panel: PublishPanel }],
};

export default module;
