import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

async function copyFiles(sourceRoot: string, targetRoot: string, files: readonly string[]): Promise<void> {
  await mkdir(targetRoot, { recursive: true });
  await Promise.all(files.map((file) => copyFile(resolve(sourceRoot, file), resolve(targetRoot, file))));
}

await Promise.all([
  copyFiles(
    resolve(projectRoot, 'node_modules/swagger-ui-dist'),
    resolve(projectRoot, 'dist/swagger-ui'),
    ['swagger-ui.css', 'swagger-ui-bundle.js', 'swagger-ui-standalone-preset.js'],
  ),
  copyFiles(
    resolve(projectRoot, 'node_modules/@scalar/api-reference/dist/browser'),
    resolve(projectRoot, 'dist/scalar'),
    ['standalone.js'],
  ),
]);
