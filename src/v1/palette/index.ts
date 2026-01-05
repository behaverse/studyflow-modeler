import Palette from './Palette';
import MorePopupMenu from './MorePopupMenu';
// import StudyflowPopupMenu from './StudyflowPopupMenu';

export default {
  __init__: [
    'mainPalette',
    // 'studyflowPopupMenu',
    'morePopupMenu',
  ],
  mainPalette: ['type', Palette],
  // studyflowPopupMenu: ['type', StudyflowPopupMenu],
  morePopupMenu: ['type', MorePopupMenu],
};
