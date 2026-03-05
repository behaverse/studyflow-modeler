import js from '@eslint/js'
import globals from 'globals'

export default [
  { ignores: ['dist', 'docs'] },
  {
    files: ['src/v1/**/*.{js,jsx}'],
    ignores: ['src/v1/commands/**/*.{js,jsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.type='MemberExpression'][callee.object.name='modeling'][callee.property.name='updateProperties']",
          message: 'Use executeDiagramCommand/executeModelingCommand instead of direct modeling.updateProperties.',
        },
        {
          selector: "CallExpression[callee.type='MemberExpression'][callee.object.name='modeling'][callee.property.name='updateModdleProperties']",
          message: 'Use executeDiagramCommand/executeModelingCommand instead of direct modeling.updateModdleProperties.',
        },
        {
          selector: "CallExpression[callee.type='MemberExpression'][callee.object.name='modeling'][callee.property.name='createShape']",
          message: 'Use executeDiagramCommand/executeModelingCommand instead of direct modeling.createShape.',
        },
        {
          selector: "CallExpression[callee.type='MemberExpression'][callee.object.name='modeler'][callee.property.name='importXML']",
          message: 'Use executeDiagramCommand instead of direct modeler.importXML.',
        },
      ],
    },
  },
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
]
