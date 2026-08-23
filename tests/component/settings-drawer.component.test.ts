import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

describe('settings drawer component', () => {
  const html = readFileSync(resolve(__dirname, '../../mazan-habait.html'), 'utf8');
  const document = new JSDOM(html).window.document;

  it('starts outside the accessibility tree and exposes modal relationships', () => {
    const drawer = document.querySelector<HTMLElement>('[data-testid="drawer"]')!;
    const opener = document.querySelector<HTMLElement>('[data-testid="btn-set"]')!;

    expect(drawer.getAttribute('role')).toBe('dialog');
    expect(drawer.getAttribute('aria-modal')).toBe('true');
    expect(drawer.getAttribute('aria-hidden')).toBe('true');
    expect(drawer.hasAttribute('inert')).toBe(true);
    expect(opener.getAttribute('aria-controls')).toBe('drawer');
    expect(opener.getAttribute('aria-expanded')).toBe('false');
  });

  it('organizes settings into four clear collapsible sections', () => {
    const sections = [...document.querySelectorAll<HTMLDetailsElement>('.settings-section')];

    expect(sections.map((section) => section.dataset.testid)).toEqual([
      'settings-section-budgets',
      'settings-section-categories',
      'settings-section-data',
      'settings-section-manual',
    ]);
    expect(sections.every((section) => !section.open)).toBe(true);
    expect(sections.every((section) => section.querySelector(':scope > summary[data-i18n]'))).toBe(true);
  });
});
