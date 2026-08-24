import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'public');
const files = [
  'mazan-habait.html',
  'Architecture.html',
  'api-docs.html',
  'scalar-docs.html',
  'openapi.json',
  'design-system.css',
  'resources',
  'dist',
];

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
for (const file of files) {
  cpSync(resolve(root, file), resolve(output, file), { recursive: true });
}
