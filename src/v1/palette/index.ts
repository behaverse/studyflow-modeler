import StudyflowPalette from './Palette';
import CreateMenuProvider from './CreateMenuProvider';
import PaletteMenuProvider from './PaletteMenuProvider';

export default {
  __init__: [
    'studyFlowPalette',
    'studyFlowCreateMenuProvider',
    // 'paletteMenuProvider',
  ],
  studyFlowCreateMenuProvider: ['type', CreateMenuProvider],
  studyFlowPalette: ['type', StudyflowPalette],
  // paletteMenuProvider: ['type', PaletteMenuProvider],
};
