import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const read = (file: string) => readFileSync(resolve(root, file), 'utf8');

const ORIGIN = 'https://home-economy-stabilation.vercel.app';
const robots = read('robots.txt');
const sitemap = read('sitemap.xml');
const llms = read('llms.txt');
const html = read('mazan-habait.html');
const deployScript = read('scripts/prepare-vercel-output.ts');

/* `/` is a Vercel rewrite onto mazan-habait.html rather than a file of its own. */
const servedBy = (path: string) => (path === '/' ? 'mazan-habait.html' : path.replace(/^\//, ''));

describe('assistant and search discovery contract', () => {
  /* A discovery file that never reaches `public/` is invisible in production while
     looking perfectly correct in the repository — the one failure mode here that no
     amount of reading the file itself would catch. */
  it('deploys every discovery file to the published output', () => {
    for (const file of ['robots.txt', 'sitemap.xml', 'llms.txt']) {
      expect(existsSync(resolve(root, file)), `${file} is missing from the repository`).toBe(true);
      expect(deployScript, `${file} is never copied into public/`).toContain(`'${file}'`);
    }
  });

  /* IndexNow is how Bing — and so Edge, Copilot and DuckDuckGo — learns about a change
     without waiting to be crawled. Ownership is proven by a file whose *name* is the
     key and whose *contents* are the same key; if those two ever disagree, or the file
     never deploys, every submission is rejected and nothing says so out loud. */
  it('proves IndexNow ownership with a key file that deploys and agrees with itself', () => {
    const keyFiles = readdirSync(root).filter((name) => /^[0-9a-f]{32}\.txt$/.test(name));
    expect(keyFiles, 'expected exactly one IndexNow key file at the root').toHaveLength(1);

    const [keyFile] = keyFiles;
    expect(read(keyFile).trim()).toBe(keyFile.replace(/\.txt$/, ''));
    // Matched by pattern in the deploy script rather than named, so key rotation
    // cannot leave the published keyLocation pointing at a file that is not there.
    expect(deployScript).toContain('[0-9a-f]{32}\\.txt');
    expect(read('scripts/submit-indexnow.ts')).toContain('api.indexnow.org/IndexNow');
  });

  it('names the assistant crawlers explicitly rather than relying on the wildcard', () => {
    // Naming them is the point: a bare `User-agent: *` leaves it ambiguous whether
    // an AI crawler was considered, and several of these check for their own token.
    for (const agent of [
      'GPTBot', 'OAI-SearchBot', 'ChatGPT-User',
      'ClaudeBot', 'Claude-SearchBot', 'Claude-User',
      'Google-Extended', 'PerplexityBot', 'Applebot-Extended',
      'Bingbot', 'meta-externalagent', 'CCBot',
    ]) {
      expect(robots, `robots.txt does not mention ${agent}`).toMatch(new RegExp(`^User-agent: ${agent}$`, 'm'));
    }
    expect(robots).toMatch(/^Allow: \/$/m);
    expect(robots).toMatch(/^Disallow: \/api\/$/m);
    expect(robots).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
  });

  it('lists only canonical URLs that resolve to a deployed document', () => {
    const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);

    expect(locations.length).toBeGreaterThan(0);
    for (const location of locations) {
      expect(location.startsWith(`${ORIGIN}/`), `${location} is not on the canonical origin`).toBe(true);
      const file = servedBy(new URL(location).pathname);
      expect(existsSync(resolve(root, file)), `${location} has no document behind it`).toBe(true);
      expect(deployScript, `${location} is never deployed`).toContain(`'${file}'`);
    }
    // The duplicate belongs behind the canonical, never in the sitemap beside it.
    expect(locations).not.toContain(`${ORIGIN}/mazan-habait.html`);
  });

  it('keeps llms.txt in the documented shape with links that resolve', () => {
    expect(llms).toMatch(/^# .+/);
    expect(llms).toMatch(/^> .+/m);

    const onSite = [...llms.matchAll(/\]\((https:\/\/[^)]+)\)/g)]
      .map((match) => match[1])
      .filter((url) => url.startsWith(ORIGIN));

    expect(onSite.length).toBeGreaterThan(0);
    for (const url of onSite) {
      const path = new URL(url).pathname;
      expect(existsSync(resolve(root, servedBy(path))), `${url} points at nothing`).toBe(true);
    }
  });

  /* Largest Contentful Paint is a ranking input, and text cannot paint until its face
     arrives. Two things here are worth holding still: every declared file must exist,
     and no `src` may carry a descriptor the browser rejects. `tech()` silently
     invalidated the whole `src` once, which drops the face to a system fallback while
     the page still looks broadly right. */
  it('declares one variable face per subset, each pointing at a file that exists', () => {
    const css = read('fonts/fonts.css');
    const faces = [...css.matchAll(/@font-face\s*\{([\s\S]*?)\}/g)].map((match) => match[1]);
    expect(faces).toHaveLength(6);

    for (const face of faces) {
      const src = face.match(/src: url\(([^)]+)\) format\('woff2'\);/);
      expect(src, `a face has no plain woff2 src: ${face.trim().slice(0, 60)}`).not.toBeNull();
      expect(existsSync(resolve(root, 'fonts', src![1])), `${src![1]} is declared but absent`).toBe(true);
      // A range, not a single value: one file serves every weight on the axis.
      expect(face).toMatch(/font-weight: \d{3} \d{3};/);
      expect(face).toContain('font-display: swap');
    }
    expect(css).not.toContain('tech(');

    const preloaded = [...read('mazan-habait.html').matchAll(/rel="preload"[^>]*href="fonts\/([^"]+)"/g)];
    expect(preloaded.length).toBeGreaterThan(0);
    for (const [, file] of preloaded) {
      // A preload the stylesheet never requests is wasted bytes and a console warning.
      expect(css, `${file} is preloaded but no face uses it`).toContain(`url(${file})`);
    }
  });

  it('points both duplicate addresses of the application at one canonical URL', () => {
    expect(html).toContain(`<link rel="canonical" href="${ORIGIN}/">`);
    expect(html).toMatch(/<meta name="description" content="[^"]{80,}">/);
    expect(html).toMatch(/<meta name="robots" content="[^"]*index[^"]*">/);
    for (const property of ['og:title', 'og:description', 'og:url', 'og:type', 'og:image']) {
      expect(html, `missing ${property}`).toContain(`property="${property}"`);
    }
  });

  it('describes the application in structured data a machine can parse', () => {
    const block = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    expect(block, 'no JSON-LD block in the document').not.toBeNull();

    const data = JSON.parse(block![1]) as { '@context': string; '@graph': Array<Record<string, unknown>> };
    expect(data['@context']).toBe('https://schema.org');

    const graph = data['@graph'];
    const node = (type: string) => graph.find((entry) => entry['@type'] === type)!;
    // WebSite is what earns the site name in a result rather than a bare domain,
    // and Organization is the entity the other two hang off.
    expect(node('WebSite')).toMatchObject({ url: `${ORIGIN}/`, inLanguage: 'he-IL' });
    expect(node('Organization')).toBeDefined();

    const app = node('WebApplication');
    expect(app.url).toBe(`${ORIGIN}/`);
    expect(app.applicationCategory).toBe('FinanceApplication');
    // The page's central claim is that it is free and needs no account; structured
    // data that disagreed with the visible text would be the kind of mismatch search
    // engines penalise, so the zero price is asserted rather than assumed.
    expect(app.isAccessibleForFree).toBe(true);
    expect(app.offers).toMatchObject({ price: '0' });
    expect(Array.isArray(app.featureList)).toBe(true);

    // A node referring to an @id that no node defines is a silently broken graph.
    const defined = new Set(graph.map((entry) => entry['@id']));
    for (const reference of JSON.stringify(graph).matchAll(/"@id":"([^"]+)"/g)) {
      expect(defined, `dangling @id ${reference[1]}`).toContain(reference[1]);
    }
  });
});
