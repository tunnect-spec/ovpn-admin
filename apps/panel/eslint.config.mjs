import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// FlatCompat is retained for compatibility with any legacy (.eslintrc-style)
// shareable configs that may be added later. eslint-config-next@16 ships native
// flat configs, so its presets are spread directly instead of via
// compat.extends() (FlatCompat's legacy loader cannot validate a flat config and
// throws a circular-structure error under ESLint 10).
const compat = new FlatCompat({
  baseDirectory: __dirname,
});
void compat;

const eslintConfig = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'test-results/**',
      'playwright-report/**',
      'next-env.d.ts',
    ],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    // Pin the React version explicitly so eslint-plugin-react does not invoke
    // its runtime version-detection path, which calls the legacy
    // context.getFilename() API that was removed in ESLint 10.
    settings: {
      react: { version: '19.0' },
    },
    rules: {
      // These two rules come from the experimental React Compiler lint set. They
      // flag patterns that are correct and intentional here — resetting error
      // state at the start of an async fetch (set-state-in-effect) and reading
      // Date.now() during render for relative-time display (purity). We don't run
      // the React Compiler, so treat them as advisory warnings rather than errors
      // instead of contorting working code to satisfy a compiler we don't use.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
    },
  },
];

export default eslintConfig;
