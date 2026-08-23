import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

describe('financial agents component', () => {
  it('publishes an accessible translated host for seven independent agents', () => {
    const html = readFileSync(resolve(__dirname, '../../mazan-habait.html'), 'utf8');
    const document = new JSDOM(html).window.document;
    const root = document.querySelector('[data-testid="agents"]');

    expect(root).not.toBeNull();
    expect(root?.getAttribute('aria-labelledby')).toBe('agents-h');
    expect(root?.querySelector('[data-testid="agent-grid"]')).not.toBeNull();
    expect(root?.querySelector('[data-i18n="agentsIntro"]')).not.toBeNull();
  });

  it('puts one transparent safe-to-spend number before the detailed dashboard', () => {
    const html = readFileSync(resolve(__dirname, '../../mazan-habait.html'), 'utf8');
    const document = new JSDOM(html).window.document;
    const guide = document.querySelector('[data-testid="spending-guide"]');
    const dashboard = document.querySelector('[data-testid="hero-h"]')?.closest('section');

    expect(guide?.getAttribute('aria-labelledby')).toBe('spending-guide-h');
    expect(guide?.querySelector('[aria-live="polite"]')).not.toBeNull();
    expect(guide?.querySelector('details [data-testid="spending-guide-balance"]')).not.toBeNull();
    expect(guide?.compareDocumentPosition(dashboard!) & 4).toBeTruthy();
  });
});
