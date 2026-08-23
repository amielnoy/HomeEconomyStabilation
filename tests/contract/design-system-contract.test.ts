import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const css = readFileSync(resolve(root, 'design-system.css'), 'utf8');

describe('design system contract', () => {
  it.each([
    '--ds-font-body', '--ds-font-display', '--ds-space-1', '--ds-space-4',
    '--ds-radius-sm', '--ds-radius-lg', '--ds-text', '--ds-surface',
    '--ds-action', '--ds-focus', '--ds-shadow-1', '--ds-motion-fast',
  ])('defines the required semantic token %s', (token) => {
    expect(css).toMatch(new RegExp(`${token}\\s*:`));
  });

  it.each(['ds-surface', 'ds-title', 'ds-button', 'ds-field', 'ds-status', 'ds-link-card', 'locale-picker'])
    ('publishes the reusable .%s component recipe', (className) => {
      expect(css).toMatch(new RegExp(`\\.${className}(?:[\\s:{.,]|$)`));
    });

  it('provides visible focus and reduced-motion behavior', () => {
    expect(css).toContain(':focus-visible');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('defines the Amharic typeface and both drawer directions', () => {
    expect(css).toContain(':root[data-locale="am"]');
    expect(css).toContain('Noto Sans Ethiopic');
    expect(css).toContain('html[dir="ltr"] .drawer');
    expect(css).toContain('html[dir="rtl"] .drawer');
  });
});
