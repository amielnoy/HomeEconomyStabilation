import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

const pageMarkup = readFileSync(resolve(__dirname, '../../mazan-habait.html'), 'utf8');

describe('marketing landing component', () => {
  beforeEach(() => {
    document.body.innerHTML = pageMarkup;
  });

  it('offers a primary free-check CTA and a lower-page conversion CTA', () => {
    const primary = document.querySelector<HTMLButtonElement>('[data-testid="marketing-upload"]');
    const final = document.querySelector<HTMLButtonElement>('[data-testid="marketing-upload-final"]');

    expect(primary?.dataset.i18n).toBe('startFreeCheck');
    expect(primary?.classList.contains('primary')).toBe(true);
    expect(final?.dataset.i18n).toBe('startFreeCheck');
  });

  it('explains value through three concrete benefits', () => {
    expect(document.querySelectorAll('[data-testid="marketing-benefit-card"]')).toHaveLength(3);
    expect(document.querySelector('[data-i18n="benefitClarityTitle"]')).not.toBeNull();
    expect(document.querySelector('[data-i18n="benefitActionTitle"]')).not.toBeNull();
    expect(document.querySelector('[data-i18n="benefitPrivacyTitle"]')).not.toBeNull();
  });

  it('makes the local-only privacy promise prominent', () => {
    expect(document.querySelector('[data-i18n="trustPrivate"]')?.textContent).toContain('נשארים במכשיר');
    expect(document.querySelector('[data-i18n="benefitPrivacyText"]')?.textContent).toContain('אינם מועלים');
  });

  it('does not copy unverifiable savings or scarcity claims from the reference page', () => {
    const landingText = document.querySelector('[data-testid="empty"]')?.textContent || '';

    expect(landingText).not.toMatch(/2,000|6,000|90 יום|מקומות אחרונים/);
  });
});
