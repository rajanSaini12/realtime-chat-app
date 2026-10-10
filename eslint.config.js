import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default [
  { ignores: ['node_modules/', 'coverage/'] },
  js.configs.recommended,
  {
    files: ['src/**/*.js', 'test/**/*.js', '*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: globals.node },
  },
  {
    // The browser client is plain scripts; `io` comes from /socket.io/socket.io.js.
    files: ['public/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: { ...globals.browser, io: 'readonly' },
    },
  },
  {
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always'],
      'prefer-const': 'error',
    },
  },
  // Must be last: turns off stylistic rules that would fight with Prettier.
  prettier,
];
