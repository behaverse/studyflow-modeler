import js from '@eslint/js'
import globals from 'globals'
import tsParser from '@typescript-eslint/parser'

export default [
  { ignores: ['dist', 'docs'] },
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
    settings: {},
    plugins: {
    },
    rules: {
      ...js.configs.recommended.rules,
      'react/jsx-no-target-blank': 'off',
    },
  },
  // Enforce the modeler/runner boundary: both depend on @/lib/core, never on each other.
  // Uses @typescript-eslint/parser only as a parser - no rule plugin needed for this check.
  {
    files: ['src/runner/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaFeatures: { jsx: true }, sourceType: 'module' },
    },
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['@/modeler/*', '@/modeler'], message: 'runner/ may not import from modeler/. Move shared code into src/lib/core/.' },
          { group: ['../modeler/*', '../../modeler/*', '../../../modeler/*'], message: 'runner/ may not import from modeler/. Move shared code into src/lib/core/.' },
        ],
      }],
    },
  },
  {
    files: ['src/modeler/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaFeatures: { jsx: true }, sourceType: 'module' },
    },
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['@/runner/*', '@/runner'], message: 'modeler/ may not import from runner/. Move shared code into src/lib/core/.' },
          { group: ['../runner/*', '../../runner/*', '../../../runner/*'], message: 'modeler/ may not import from runner/. Move shared code into src/lib/core/.' },
        ],
      }],
    },
  },
]
