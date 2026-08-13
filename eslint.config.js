import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

// Two enforced boundaries: core/ is framework-free, and modeler/ and runner/
// never import each other (shared code goes to core/).
export default [
  { ignores: ['dist', '**/dist', 'docs', 'playwright-report', 'test-results'] },
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      ...js.configs.recommended.rules,
    },
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
      // The moddle/bpmn-js boundary is genuinely untyped in places.
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },

  {
    files: ['packages/modeler/src/**/*.{ts,tsx}', 'packages/runner/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs['recommended-latest'].rules,
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['@modeler/*', '@runner/*'], message: 'modeler/ and runner/ may not import each other. Move shared code into packages/core/.' },
        ],
      }],
    },
  },
  // Each app may of course import itself; re-allow its own prefix.
  {
    files: ['packages/modeler/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['@runner/*'], message: 'modeler/ may not import from runner/. Move shared code into packages/core/.' },
        ],
      }],
    },
  },
  {
    files: ['packages/runner/src/**/*.{ts,tsx}'],
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
        message: 'core/ is the domain layer: it may not name a bpmn-js service, even as `any`. Accept a port (see `Writer`) and let modeler/ pass the adapter.',
      }],
    },
  },
]
