import { defineConfig, globalIgnores } from 'eslint/config';
import js from '@eslint/js';
import ts from 'typescript-eslint';
import hooks from 'eslint-plugin-react-hooks';
export default defineConfig([
  globalIgnores(['.next/**', '.local/**', 'node_modules/**', 'next-env.d.ts', 'public/sw.js']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...ts.configs.recommended],
    plugins: { 'react-hooks': hooks },
    rules: { ...hooks.configs.recommended.rules },
  },
]);
