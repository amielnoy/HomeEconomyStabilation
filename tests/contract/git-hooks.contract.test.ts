import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/* The pre-push gate is worth exactly as much as its wiring. A hook that lost its execute
   bit, or an installer no longer run from `prepare`, fails open: every push is allowed and
   nobody finds out until CI goes red again for the reason the hook was written to catch.
   So the wiring is asserted rather than assumed. */

const root = resolve(__dirname, '../..');
const read = (file: string) => readFileSync(resolve(root, file), 'utf8');
const packageJson = JSON.parse(read('package.json')) as { scripts: Record<string, string> };

describe('git hook contract', () => {
  it.each(['.githooks/pre-push', 'scripts/install-git-hooks.sh'])('keeps %s executable', (file) => {
    // 0o111: a hook git cannot execute is a hook git skips, silently.
    expect(statSync(resolve(root, file)).mode & 0o111).toBeGreaterThan(0);
  });

  it('installs the hooks path from npm install rather than from a paragraph in a readme', () => {
    expect(packageJson.scripts.prepare).toContain('install-git-hooks.sh');
    expect(packageJson.scripts['hooks:install']).toContain('install-git-hooks.sh');
    expect(read('scripts/install-git-hooks.sh')).toContain('git config core.hooksPath .githooks');
  });

  /* A checkout that is not a git repository — a tarball, a Docker build context, a Vercel
     build — must not fail its install over a developer convenience. */
  it('leaves a checkout that is not a git repository alone', () => {
    expect(read('scripts/install-git-hooks.sh')).toContain('git rev-parse --git-dir');
  });

  it('runs the Vitest gate and refuses unresolved merge markers', () => {
    const hook = read('.githooks/pre-push');

    expect(hook).toContain('npm test');
    expect(hook).toMatch(/<<<<<<</);
    // The escape hatch is named in the hook itself, where someone blocked by it will read it.
    expect(hook).toContain('--no-verify');
  });
});
