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

  it('places official tools, adviser registries and support organizations before management companies', () => {
    const directory = document.querySelector('[data-testid="savings-directory"]')!;
    const links = [...directory.querySelectorAll<HTMLAnchorElement>('[data-testid$="-link"]')];

    expect(links).toHaveLength(20);
    expect(links.slice(0, 4).map((link) => new URL(link.href).hostname)).toEqual([
      'gemelnet.cma.gov.il',
      'pensyanet.cma.gov.il',
      'www.gov.il',
      'www.gov.il',
    ]);
    expect(directory.querySelectorAll('[data-i18n="official"]')).toHaveLength(6);
    expect(links.slice(4, 6).map((link) => new URL(link.href).hostname)).toEqual([
      'www.gov.il',
      'www.new.isa.gov.il',
    ]);
    expect(links[6].hostname).toBe('www.hon.co.il');
    expect(links.slice(7, 10).map((link) => new URL(link.href).hostname)).toEqual([
      'www.paamonim.org',
      'mekimi.org.il',
      'www.whatsapp.com',
    ]);
    expect(directory.querySelector('[data-testid="support-organizations-section"]')).not.toBeNull();
  });

  it('offers both communities and names what each one costs in privacy', () => {
    const section = document.querySelector('[data-testid="community-section"]')!;
    const whatsapp = section.querySelector<HTMLAnchorElement>('[data-testid="community-whatsapp-link"]')!;
    const telegram = section.querySelector<HTMLAnchorElement>('[data-testid="community-telegram-link"]')!;

    // Neither is presented as the safer choice: each card states the protection it
    // gives and the one it withholds, so the reader picks the trade-off they want.
    expect(whatsapp.textContent).toContain('מוצפן מקצה לקצה');
    expect(whatsapp.textContent).toContain('מחייבת מספר טלפון');
    expect(telegram.textContent).toContain('להסתיר את מספר הטלפון');
    expect(telegram.textContent).toContain('אינן מוצפנות מקצה לקצה');
    expect(whatsapp.querySelector('.ds-status')?.getAttribute('data-tone'))
      .toBe(telegram.querySelector('.ds-status')?.getAttribute('data-tone'));
  });

  it('warns that the on-device promise stops at the community door', () => {
    const disclaimer = document.querySelector('[data-testid="community-disclaimer"]');

    expect(disclaimer?.textContent).toContain('שירות חיצוני');
    expect(disclaimer?.textContent).toContain('אל תשתפו דוחות בנק');
  });

  it('uses official registries and explains how to verify independence', () => {
    const section = document.querySelector('[data-testid="independent-advisors-section"]')!;
    const pensionRegistry = section.querySelector<HTMLAnchorElement>('[data-testid="advisor-pension-registry-link"]')!;
    const investmentRegistry = section.querySelector<HTMLAnchorElement>('[data-testid="advisor-investment-registry-link"]')!;

    expect(pensionRegistry.href).toBe('https://www.gov.il/he/service/agents_and_consultants_search');
    expect(investmentRegistry.href).toBe('https://www.new.isa.gov.il/tax_licensing_advisors_tree/page/magar');
    expect(section.textContent).toContain('אין כאן דירוג או רשימת מומלצים');
    expect(section.textContent).toContain('מי משלם ליועץ');
    expect(section.querySelectorAll('[data-testid="advisor-checklist"] li')).toHaveLength(3);
  });

  it('lists Dorit Gov Ari without presenting the requested entry as an endorsement', () => {
    const link = document.querySelector<HTMLAnchorElement>('[data-testid="advisor-dorit-gov-ari-link"]')!;

    expect(link.href).toBe('https://www.hon.co.il/professional/%D7%92%D7%95%D7%91-%D7%90%D7%A8%D7%99-%D7%93%D7%95%D7%A8%D7%99%D7%AA/');
    expect(link.textContent).toContain('דורית גוב ארי');
    expect(link.textContent).toContain('אינה המלצה או אימות עצמאות');
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
