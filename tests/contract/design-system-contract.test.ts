import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const css = readFileSync(resolve(root, 'design-system.css'), 'utf8');
const page = readFileSync(resolve(root, 'mazan-habait.html'), 'utf8');

describe('design system contract', () => {
  it.each([
    '--ds-font-body', '--ds-font-display', '--ds-space-1', '--ds-space-4',
    '--ds-radius-sm', '--ds-radius-lg', '--ds-text', '--ds-surface',
    '--ds-action', '--ds-focus', '--ds-shadow-1', '--ds-motion-fast',
    '--ds-control-sm', '--ds-control-md', '--ds-control-touch', '--ds-text-sm',
    '--ds-positive', '--ds-warning', '--ds-critical',
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

  it('supports system contrast preferences and touch-sized mobile controls', () => {
    expect(css).toContain('@media (prefers-contrast: more)');
    expect(css).toContain('@media (forced-colors: active)');
    expect(css).toMatch(/max-width:\s*560px[\s\S]*\.btn\.btn[\s\S]*--ds-control-touch/);
  });

  it('publishes complete button interaction states and semantic variants', () => {
    expect(css).toContain('[data-variant="primary"]');
    expect(css).toContain('[data-variant="quiet"]');
    expect(css).toContain('[data-variant="destructive"]');
    expect(css).toContain(':disabled');
    expect(css).toContain('[aria-disabled="true"]');
  });

  it('owns the reusable button and card recipes outside the page stylesheet', () => {
    expect(css).toMatch(/\.ds-button,\s*\n\.btn\s*\{/);
    expect(css).toMatch(/\.ds-surface,\s*\n\.card\s*\{/);
    expect(page).not.toMatch(/\.btn\s*\{\s*display:/);
    expect(page).not.toMatch(/\.card\s*\{\s*background:/);
  });

  it('uses the semantic destructive variant instead of an inline color override', () => {
    expect(page).toContain('class="btn sm destructive" id="dr-wipe"');
    expect(page).not.toMatch(/id="dr-wipe"[^>]*style=/);
  });

  it('defines the Amharic typeface and both drawer directions', () => {
    expect(css).toContain(':root[data-locale="am"]');
    expect(css).toContain('Noto Sans Ethiopic');
    expect(css).toContain('html[dir="ltr"] .drawer');
    expect(css).toContain('html[dir="rtl"] .drawer');
  });
});
