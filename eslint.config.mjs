import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

// The enforced boundaries: core/ is framework-free and names no bpmn-js service; moddle is core/document's, which
// reads and writes BPMN XML with it; the modeler and the browser runtime never import each other (what both need
// lives in core/, their shared localStorage in @core/storage); the modeler reaches the canvas through its index
// only; and the canvas's study/ needs no DOM.

// What reaches moddle: the library itself, and core/document's modules but its surface (the barrel, the images, the
// digest, the schema body, the outline geometry).
const MODDLE = {
  selector: 'ImportDeclaration[source.value=/^(bpmn-moddle|@core\\/document\\/(?!(index|png|svg|digest|schema-body|outline)(\\.ts)?$).*)$/]',
  message: 'moddle is core/document\'s: read and write a study through the study model, and BPMN XML through @core/document.',
};
// The bpmn-js services core/ may not name, even as `any`.
const BPMN_JS_SERVICES = {
  selector: 'Identifier[name=/^(modeling|bpmnFactory|elementRegistry|commandStack|eventBus|modeler|injector|popupMenu|contextPad)$/]',
  message: 'core/ is the domain layer: it may not name a bpmn-js service, even as `any`. Accept a port (see `AttributeUpdater`) and let the caller pass the adapter.',
};

export default [
  // `.claude/worktrees` holds other checkouts of this repo, each linted in its own.
  { ignores: ['dist', '**/dist', 'docs', 'playwright-report', 'test-results', 'coverage', '.claude'] },
  // The repo's JavaScript is Node scripts: the release, the example renderer, the Electron shell, a dev proxy.
  {
    files: ['**/*.mjs'],
    languageOptions: { globals: globals.node },
    rules: js.configs.recommended.rules,
  },

  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ['**/*.{ts,tsx}'],
  })),
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true }, sourceType: 'module' },
    },
    rules: {
      // `tsc --noUnusedLocals` already reports these program-wide.
      '@typescript-eslint/no-unused-vars': 'off',
      // The moddle boundary is untyped; a thousand warnings nobody reads is worse than none.
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  {
    files: ['packages/modeler/src/**/*.{ts,tsx}', 'packages/runtime-browser/src/**/*.{ts,tsx}', 'skills/*/browser/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs['recommended-latest'].rules,
  },
  // Each app may import itself but not the other.
  {
    files: ['packages/modeler/src/**/*.{ts,tsx}', 'skills/*/modeler.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['@runner/*'], message: 'modeler/ may not import from runner/. Move shared code into packages/core/.' },
          { group: ['@canvas/*', '!@canvas/index.ts'], message: 'The canvas\'s surface is packages/canvas/src/index.ts; export what the modeler needs there.' },
        ],
      }],
    },
  },
  {
    // The browser runtime, and a skill's `browser/` folder, one of its node modules.
    files: ['packages/runtime-browser/src/**/*.{ts,tsx}', 'skills/*/browser/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['@modeler/*'], message: 'runner/ may not import from modeler/. Move shared code into packages/core/.' },
        ],
      }],
    },
  },

  // The canvas's study/ is the part that runs without a DOM (Node, tests, the CLI): it imports only itself and core,
  // and names no DOM global.
  {
    files: ['packages/canvas/src/study/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['@canvas/*', '!@canvas/study'], message: 'study/ runs without a DOM: import only study/ and @core.' },
        ],
      }],
      'no-restricted-globals': ['error',
        ...['document', 'window', 'navigator', 'getComputedStyle', 'requestAnimationFrame', 'ResizeObserver', 'XMLSerializer',
          'DOMParser', 'Node', 'Element', 'HTMLElement', 'SVGElement', 'Event'].map((name) => ({
          name, message: 'study/ runs without a DOM; drawing and input belong to render/, interaction/ and view/.',
        })),
      ],
    },
  },

  // A view writes only through the study: its verbs, and `settle` for what a gesture moved in place. The mutator is
  // study/'s own.
  {
    files: ['packages/canvas/src/**/*.ts'],
    ignores: ['packages/canvas/src/study/**'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{ group: ['@canvas/study/mutator.ts'], message: 'A view writes through the study (its verbs, settle), never the mutator.' }],
        paths: [{ name: '@canvas/study/Study.ts', importNames: ['studyMutator'], message: 'A view writes through the study (its verbs, settle), never the mutator.' }],
      }],
    },
  },

  // The <studyflow-canvas> element is built on the canvas's index alone: what it needs, any host has.
  {
    files: ['packages/canvas/src/element.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{ regex: '^(?!\\./index\\.ts$)', message: 'element.ts is built on the index alone: export what it needs there.' }],
      }],
    },
  },

  {
    files: ['packages/core/src/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['react', 'react-dom', 'react/*', 'react-dom/*'], message: 'core/ is the shared framework-free model: no React.' },
          { group: ['bpmn-js', 'bpmn-js/*', 'diagram-js', 'diagram-js/*'], message: 'core/ is the shared framework-free model: no bpmn-js or diagram-js.' },
          { group: ['@modeler/*', '@runner/*'], message: 'core/ may not depend on either app.' },
        ],
      }],
      // Import bans miss services passed in as `any`; ban the names too.
      'no-restricted-syntax': ['error', BPMN_JS_SERVICES],
    },
  },
  {
    files: ['packages/core/src/**/*.ts'],
    ignores: ['packages/core/src/document/**'],
    rules: { 'no-restricted-syntax': ['error', BPMN_JS_SERVICES, MODDLE] },
  },
  {
    files: ['packages/*/src/**/*.{ts,tsx}', 'skills/**/*.{ts,tsx}'],
    ignores: ['packages/core/src/**', 'skills/*/tests/**'],
    rules: { 'no-restricted-syntax': ['error', MODDLE] },
  },
  // An e2e spec takes `test` from tests/e2e.ts, whose fixture is how `npm run coverage` sees what the browser ran.
  {
    files: ['**/*.spec.ts'],
    ignores: ['**/*.unit.spec.ts', '**/*.webkit.spec.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [{ name: '@playwright/test', importNames: ['test'], message: 'An e2e spec takes `test` from tests/e2e.ts (`@tests/e2e`), so `npm run coverage` records what its pages run.' }],
      }],
    },
  },
]
