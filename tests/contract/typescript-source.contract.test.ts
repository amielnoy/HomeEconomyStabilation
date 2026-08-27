import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');

function sourceFiles(directory: string): string[] {
  return readdirSync(resolve(root, directory), { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    return entry.isDirectory() ? sourceFiles(path) : [path];
  });
}

describe('TypeScript source contract', () => {
  it('keeps project-owned executable source out of JavaScript files', () => {
    const rootFiles = readdirSync(root)
      .filter((file) => !file.startsWith('.') && statSync(resolve(root, file)).isFile());
    const ownedSources = [...sourceFiles('src'), ...sourceFiles('scripts'), ...sourceFiles('tests'), ...rootFiles];
    const javascript = ownedSources.filter((file) => ['.js', '.mjs', '.cjs'].includes(extname(file)));
    expect(javascript).toEqual([]);
  });

  it('loads all project-owned browser behavior from compiled TypeScript modules', () => {
    for (const file of ['mazan-habait.html', 'Architecture.html', 'api-docs.html', 'scalar-docs.html']) {
      const html = readFileSync(resolve(root, file), 'utf8');
      /* `application/ld+json` is exempt because it is not script: the browser treats
         it as a data block, never executes it, and CSP `script-src` does not govern
         it — which is why the structured data in the head coexists with the
         no-unsafe-inline policy asserted below. Executable inline script stays banned. */
      expect(html, `${file} contains inline JavaScript`)
        .not.toMatch(/<script(?![^>]*\bsrc=)(?![^>]*\btype="application\/ld\+json")[^>]*>/i);
    }
    expect(readFileSync(resolve(root, 'Architecture.html'), 'utf8')).toContain('dist/architecture.js');
    expect(readFileSync(resolve(root, 'api-docs.html'), 'utf8')).toContain('/dist/api-docs.js');
    expect(readFileSync(resolve(root, 'scalar-docs.html'), 'utf8')).toContain('/dist/scalar-docs.js');
    const vercel = readFileSync(resolve(root, 'vercel.json'), 'utf8');
    expect(vercel).toContain("script-src 'self'");
    expect(vercel).not.toContain("script-src 'self' 'unsafe-inline'");
  });
});
