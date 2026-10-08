import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

describe('cloud sync component', () => {
  it('ships hidden by default with a sync trigger and a dormant reconciliation choice', () => {
    const html = readFileSync(resolve(__dirname, '../../fe/mazan-habait.html'), 'utf8');
    const document = new JSDOM(html).window.document;
    const root = document.querySelector('[data-testid="cloud-sync"]')!;
    const title = document.querySelector<HTMLElement>('[data-testid="cloud-sync-title"]')!;
    const reconciliation = document.querySelector('[data-testid="cloud-reconciliation"]')!;

    expect(root.hidden).toBe(true);
    expect(title.hidden).toBe(true);
    expect(root.getAttribute('aria-labelledby')).toBe('cloud-sync-heading');
    expect(document.querySelector('[data-testid="cloud-sync-now"]')).not.toBeNull();
    expect((reconciliation as HTMLElement).hidden).toBe(true);
    expect(document.querySelector('[data-testid="cloud-reconciliation-keep"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="cloud-reconciliation-use-cloud"]')).not.toBeNull();
  });
});
