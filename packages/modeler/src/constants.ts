export const URLS = {
  githubRepo: 'https://github.com/behaverse/studyflow-modeler',
  docs: './docs',
} as const;

const IS_MAC =
  typeof navigator !== 'undefined' && /Mac|iPad|iPhone|iPod/.test(navigator.platform);

/** Prefix for the modifier the shortcuts below use, so labels read native on either platform. */
export const MOD_LABEL = IS_MAC ? '⌘' : 'Ctrl+';
