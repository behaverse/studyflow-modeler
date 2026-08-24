export const URLS = {
  githubRepo: 'https://github.com/behaverse/studyflow-modeler',
  apiBase: 'https://api.behaverse.org',
  apiDocs: 'https://api.behaverse.org/docs',
  docs: './docs',
} as const;

export const MODELER_FONT_FAMILY = '"IBM Plex Sans", Helvetica, sans-serif';

const IS_MAC =
  typeof navigator !== 'undefined' && /Mac|iPad|iPhone|iPod/.test(navigator.platform);

/** Prefix for the modifier the shortcuts below use, so labels read native on either platform. */
export const MOD_LABEL = IS_MAC ? '⌘' : 'Ctrl+';
