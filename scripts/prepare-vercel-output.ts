import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
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
] as const;

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
for (const file of files) {
  cpSync(resolve(root, file), resolve(output, file), { recursive: true });
}
