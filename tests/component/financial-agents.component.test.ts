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
});
