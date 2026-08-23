import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

const pageMarkup = readFileSync(resolve(__dirname, '../../mazan-habait.html'), 'utf8');

describe('savings and investments directory component', () => {
  beforeEach(() => {
    document.body.innerHTML = pageMarkup;
  });

  it('exposes the directory from the primary actions', () => {
    const button = document.querySelector<HTMLButtonElement>('[data-testid="btn-savings"]');

    expect(button).not.toBeNull();
    expect(button?.dataset.i18n).toBe('savingsDirectory');
    expect(document.querySelector('[data-testid="savings-directory"]')).not.toBeNull();
  });

  it('places official tools and support organizations before management companies', () => {
    const directory = document.querySelector('[data-testid="savings-directory"]')!;
    const links = [...directory.querySelectorAll<HTMLAnchorElement>('[data-testid$="-link"]')];

    expect(links).toHaveLength(15);
    expect(links.slice(0, 4).map((link) => new URL(link.href).hostname)).toEqual([
      'gemelnet.cma.gov.il',
      'pensyanet.cma.gov.il',
      'www.gov.il',
      'www.gov.il',
    ]);
    expect(directory.querySelectorAll('[data-i18n="official"]')).toHaveLength(4);
    expect(links.slice(4, 7).map((link) => new URL(link.href).hostname)).toEqual([
      'www.paamonim.org',
      'mekimi.org.il',
      'www.whatsapp.com',
    ]);
    expect(directory.querySelector('[data-testid="support-organizations-section"]')).not.toBeNull();
  });

  it('opens every external destination safely in a new tab', () => {
    const links = document.querySelectorAll<HTMLAnchorElement>('[data-testid$="-link"]');

    for (const link of links) {
      expect(link.protocol).toBe('https:');
      expect(link.target).toBe('_blank');
      expect(link.rel.split(/\s+/)).toEqual(expect.arrayContaining(['noopener', 'noreferrer']));
    }
  });

  it('describes support organizations without presenting them as endorsements', () => {
    const section = document.querySelector('[data-testid="support-organizations-section"]');

    expect(section?.textContent).toContain('פעמונים');
    expect(section?.textContent).toContain('מקימי');
    expect(section?.textContent).toContain('ערוץ WhatsApp של פעמונים');
    expect(section?.textContent).toContain('אנשי מקצוע ומתנדבים');
    expect(document.querySelector('[data-i18n="directoryDisclaimer"]')?.textContent)
      .toContain('אחראים לתנאי הזכאות והשירות שלהם');
  });

  it('includes a neutral financial-information disclaimer', () => {
    const disclaimer = document.querySelector('[data-i18n="directoryDisclaimer"]');

    expect(disclaimer?.textContent).toContain('אינה דירוג או המלצה');
    expect(disclaimer?.textContent).toContain('בעל רישיון');
  });
});
