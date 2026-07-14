module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  env: { browser: true, webextensions: true, es2022: true },
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  globals: { browser: 'readonly', defineBackground: 'readonly', defineContentScript: 'readonly' },
  rules: { '@typescript-eslint/no-explicit-any': 'off' },
};
