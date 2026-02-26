export { Palette as Palette } from './Palette';
import StudyflowCreateMenuProvider from './StudyflowCreateMenuProvider';
import OmniflowCreateMenuProvider from './OmniflowCreateMenuProvider';

export default {
  __init__: [
    'studyflowCreateMenuProvider',
    'omniflowCreateMenuProvider',
  ],
  paletteProvider: ['value', null],  // disable default palette
  studyflowCreateMenuProvider: ['type', StudyflowCreateMenuProvider],
  omniflowCreateMenuProvider: ['type', OmniflowCreateMenuProvider],
};
