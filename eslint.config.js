// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

const halmoni = {
  rules: {
    'no-unfiltered-soft-delete-select': require('./eslint-rules/no-unfiltered-soft-delete-select.js'),
  },
};

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*", "eslint-rules/*"],
  },
  {
    files: ["src/**/*.{ts,tsx}", "app/**/*.{ts,tsx}"],
    plugins: { halmoni },
    rules: {
      'halmoni/no-unfiltered-soft-delete-select': 'error',
    },
  },
]);
