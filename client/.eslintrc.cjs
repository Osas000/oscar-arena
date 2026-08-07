// ESLint flat/strict config — catches the exact bug classes the main project
// mandates (undefined vars, hooks rules). Run via `npm run lint` (client scope).
module.exports = {
  root: true, // stop ESLint from cascading into the parent RoyalRangersApp config
  env: { browser: true, es2021: true, node: true },
  extends: ['eslint:recommended', 'plugin:react/recommended', 'plugin:react-hooks/recommended'],
  plugins: ['react', 'react-hooks'],
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } },
  settings: { react: { version: 'detect' } },
  rules: {
    'no-undef': 'error',
    'react/react-in-jsx-scope': 'off',
    'no-unused-vars': 'warn',
  },
};