/* Ping IndexNow so Bing (and therefore Edge, Copilot and DuckDuckGo) re-crawls on
   deploy instead of waiting to be visited. One endpoint notifies every participant.
   Google does not take part — it discovers through the sitemap and ordinary crawling.

   Usage: npm run submit:indexnow            (submits every sitemap URL)
   The key file must be reachable at https://<host>/<key>.txt, which is what proves
   ownership; prepare-vercel-output copies it, and the discovery contract test checks
   that the file, its name and its contents still agree. */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HOST = 'home-economy-stabilation.vercel.app';

const keyFile = readdirSync(root).find((name) => /^[0-9a-f]{32}\.txt$/.test(name));
if (!keyFile) throw new Error('no IndexNow key file at the repository root');
const key = keyFile.replace(/\.txt$/, '');

const sitemap = readFileSync(resolve(root, 'sitemap.xml'), 'utf8');
const urlList = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
if (!urlList.length) throw new Error('sitemap.xml lists no URLs');

const response = await fetch('https://api.indexnow.org/IndexNow', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json; charset=utf-8' },
  body: JSON.stringify({ host: HOST, key, keyLocation: `https://${HOST}/${keyFile}`, urlList }),
});

// 200 accepts immediately; 202 accepts pending key validation. Both are success.
if (response.status !== 200 && response.status !== 202) {
  throw new Error(`IndexNow rejected the submission: ${response.status} ${await response.text()}`);
}
console.log(`IndexNow accepted ${urlList.length} URLs (${response.status})`);
