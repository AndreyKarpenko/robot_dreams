import js from '@eslint/js';
import ts from 'typescript-eslint';
import globals from 'globals';
export default ts.config(
  { ignores: ['node_modules/**', 'infra/**', 'dist/**'] },
  {
    files: ['**/*.ts'],
    languageOptions: { parser: ts.parser, globals: globals.node },
    rules: {
      ...js.configs.recommended.rules,
      'no-undef': 'off',
      'no-unused-vars': 'off',
      'no-constant-condition': 'error',
    },
  },
);
