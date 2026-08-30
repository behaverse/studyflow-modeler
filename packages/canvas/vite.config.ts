import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

/**
 * Dev-only Vite config for the canvas harness (`dev/harness.html`, design §5/§6 P1).
 * The package itself ships no build step — consumers import its TS source through
 * their own Vite alias — so this exists purely to serve the standalone harness that
 * renders each shipped example. No React, no Tailwind: a true leaf.
 *
 * Run: `npm run dev -w @behaverse/studyflow-canvas`, then open `/harness.html`.
 */
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: here('./dev'),
  resolve: {
    alias: [
      { find: '@canvas', replacement: here('./src') },
      { find: '@core', replacement: here('../core/src') },
      { find: '#assets', replacement: here('../../assets') },
    ],
  },
});
