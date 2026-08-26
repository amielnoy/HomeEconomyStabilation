import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const appSource = readFileSync(resolve(root, 'src/app.ts'), 'utf8');
const html = readFileSync(resolve(root, 'mazan-habait.html'), 'utf8');
const apiDocs = readFileSync(resolve(root, 'api-docs.html'), 'utf8');
const scalarDocs = readFileSync(resolve(root, 'scalar-docs.html'), 'utf8');

describe('security sanity contract', () => {
  it('does not use executable HTML or JavaScript string sinks in application code', () => {
    expect(appSource).not.toMatch(/\.innerHTML\s*=/);
    expect(appSource).not.toContain('insertAdjacentHTML');
    expect(appSource).not.toMatch(/\beval\s*\(/);
    expect(appSource).not.toContain('new Function');
  });

  it('opens every external new-tab link with opener isolation over HTTPS', () => {
    const links = [...html.matchAll(/<a\b[^>]*\bhref="(https:[^"]+)"[^>]*>/g)].map((match) => match[0]);
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link).toContain('target="_blank"');
      expect(link).toMatch(/rel="[^"]*noopener[^"]*noreferrer[^"]*"/);
      expect(link).not.toContain('http://');
    }
  });

  it('limits file pickers to the documented financial and backup formats', () => {
    /* .html/.htm is here because several Israeli banks export a statement as an
       HTML document under an .xls name. The picker still names an explicit set:
       it is an allowlist, and widening it is a decision, not an accident. */
    expect(html).toMatch(/id="file"[^>]*accept="\.xls,\.xlsx,\.csv,\.html,\.htm"/);
    expect(html).toMatch(/id="card-file"[^>]*accept="\.xls,\.xlsx,\.csv,\.html,\.htm"/);
    expect(html).toMatch(/id="dr-import"[^>]*accept="\.json,application\/json"/);
  });

  it('loads no remote executable scripts', () => {
    for (const document of [html, apiDocs, scalarDocs]) {
      expect(document).not.toMatch(/<script[^>]+src="https?:\/\//);
    }
  });
});
