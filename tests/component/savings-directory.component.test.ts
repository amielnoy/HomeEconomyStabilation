import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

const pageMarkup = readFileSync(resolve(__dirname, '../../mazan-habait.html'), 'utf8');

describe('savings and investments directory component', () => {
  beforeEach(() => {
    document.body.innerHTML = pageMarkup;
  });

  it('exposes the directory from the primary actions', () => {
    const button = document.querySelector<HTMLButtonElement>('#btn-savings');

    expect(button).not.toBeNull();
    expect(button?.dataset.i18n).toBe('savingsDirectory');
    expect(document.querySelector('#savings-directory')).not.toBeNull();
  });

  it('places official comparison tools before management companies', () => {
    const directory = document.querySelector('#savings-directory')!;
    const links = [...directory.querySelectorAll<HTMLAnchorElement>('a.ds-link-card')];

    expect(links).toHaveLength(12);
    expect(links.slice(0, 4).map((link) => new URL(link.href).hostname)).toEqual([
      'gemelnet.cma.gov.il',
      'pensyanet.cma.gov.il',
      'www.gov.il',
      'www.gov.il',
    ]);
    expect(directory.querySelectorAll('[data-i18n="official"]')).toHaveLength(4);
  });

  it('opens every external destination safely in a new tab', () => {
    const links = document.querySelectorAll<HTMLAnchorElement>('#savings-directory a[href]');

    for (const link of links) {
      expect(link.protocol).toBe('https:');
      expect(link.target).toBe('_blank');
      expect(link.rel.split(/\s+/)).toEqual(expect.arrayContaining(['noopener', 'noreferrer']));
    }
  });

  it('includes a neutral financial-information disclaimer', () => {
    const disclaimer = document.querySelector('[data-i18n="directoryDisclaimer"]');

    expect(disclaimer?.textContent).toContain('אינה דירוג או המלצה');
    expect(disclaimer?.textContent).toContain('בעל רישיון');
  });
});
