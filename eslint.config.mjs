import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

// The enforced boundaries: core/ is framework-free and names no bpmn-js service; the modeler and the browser
// runtime never import each other (what both need lives in core/, their shared localStorage in @core/storage);
// and the modeler reaches the canvas through its index only.
export default [
  { ignores: ['dist', '**/dist', 'docs', 'playwright-report', 'test-results'] },
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
    files: ['packages/modeler/src/**/*.{ts,tsx}', 'skills/browser/src/**/*.{ts,tsx}', 'skills/*/browser/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs['recommended-latest'].rules,
  },
  // Each app may import itself but not the other.
  {
    files: ['packages/modeler/src/**/*.{ts,tsx}'],
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
    // The browser runtime is the `browser` skill; another skill's `browser/` folder is one of its node modules.
    files: ['skills/browser/src/**/*.{ts,tsx}', 'skills/*/browser/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['@modeler/*'], message: 'runner/ may not import from modeler/. Move shared code into packages/core/.' },
        ],
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
      'no-restricted-syntax': ['error', {
        selector: 'Identifier[name=/^(modeling|bpmnFactory|elementRegistry|commandStack|eventBus|modeler|injector|popupMenu|contextPad)$/]',
        message: 'core/ is the domain layer: it may not name a bpmn-js service, even as `any`. Accept a port (see `AttributeUpdater`) and let the caller pass the adapter.',
      }],
    },
  },
]
