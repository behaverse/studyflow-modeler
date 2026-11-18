/** The storyboard skill's contribution to the modeler: the study as its participant's session, shown in the canvas's
 * place. Loaded when the view is first shown. */
import { lazy } from 'react';
import type { ModelerModule } from '@modeler/skillModules';

const module: ModelerModule = {
  canvasViews: [{
    id: 'storyboard',
    label: 'Storyboard',
    View: lazy(() => import('@skills/storyboard/modeler/Storyboard').then(({ Storyboard }) => ({ default: Storyboard }))),
  }],
};

export default module;
