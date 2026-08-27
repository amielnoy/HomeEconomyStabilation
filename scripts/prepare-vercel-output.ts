import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
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
  'favicon.svg',
  'design-system.css',
  // Discovery files. A crawler only ever sees these if they reach `public/`, so a
  // new one added at the repo root must be named here too — the contract test
  // `discovery.contract.test.ts` fails when it is not.
  'robots.txt',
  'sitemap.xml',
  'llms.txt',
  'fonts',
  'resources',
  'dist',
] as const;

/* The IndexNow key file is matched rather than named: its filename *is* the key, so
   rotating the key would otherwise mean editing this list too and silently shipping
   an unreachable keyLocation the day someone forgot. */
const indexNowKeys = readdirSync(root).filter((name) => /^[0-9a-f]{32}\.txt$/.test(name));

rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
for (const file of [...files, ...indexNowKeys]) {
  cpSync(resolve(root, file), resolve(output, file), { recursive: true });
}
