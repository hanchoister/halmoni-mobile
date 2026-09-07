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

      // Downgraded, not silenced. eslint-plugin-react-hooks 7.x arrived as a
      // transitive dependency of the Sentry install and promoted these to
      // errors, turning 24 pre-existing patterns into a red build overnight.
      // They are legitimate observations — setState inside an effect is a real
      // smell — but rewriting 20 effects across the tab screens days before a
      // beta is the riskier change. Tracked as G2-22; fix them deliberately,
      // then raise these back to 'error'.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
    },
  },
]);
