import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = resolve(projectRoot, 'node_modules/swagger-ui-dist');
const targetRoot = resolve(projectRoot, 'dist/swagger-ui');

await mkdir(targetRoot, { recursive: true });
await Promise.all([
  'swagger-ui.css',
  'swagger-ui-bundle.js',
  'swagger-ui-standalone-preset.js',
].map((file) => copyFile(resolve(sourceRoot, file), resolve(targetRoot, file))));
