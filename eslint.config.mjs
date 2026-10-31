import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', 'assets/', 'dist/', 'out/', 'release/'] }, // build output is gitignored too
  js.configs.recommended,
  {
    // renderer (ES modules in the browser)
    files: ['src/**/*.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.browser } },
    rules: {
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    // Electron main process + preload (CommonJS)
    files: ['main.js', 'preload.js', 'updater.js', 'mcp/**/*.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'commonjs', globals: { ...globals.node } },
  },
  {
    // scripts that run inside the renderer (loaded by scripts/e2e.mjs)
    files: ['test/e2e/**/*.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'script', globals: { ...globals.browser } },
  },
  {
    // scripts and tests (Node ES modules)
    files: ['scripts/**/*.mjs', 'test/**/*.mjs', 'eslint.config.mjs'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.node } },
  },
];
