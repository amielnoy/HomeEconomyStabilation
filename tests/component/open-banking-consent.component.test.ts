import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

describe('open banking consent component', () => {
  it('ships hidden by default and requires an unselected explicit choice', () => {
    const html = readFileSync(resolve(__dirname, '../../fe/mazan-habait.html'), 'utf8');
    const document = new JSDOM(html).window.document;
    const root = document.querySelector('[data-testid="open-banking-consent"]')!;
    const checkbox = root.querySelector<HTMLInputElement>('[data-testid="open-banking-consent-check"]')!;
    const button = root.querySelector<HTMLButtonElement>('[data-testid="open-banking-consent-accept"]')!;

    expect(root.hidden).toBe(true);
    expect(root.getAttribute('aria-labelledby')).toBe('open-banking-consent-heading');
    expect(checkbox.checked).toBe(false);
    expect(button.disabled).toBe(true);
    for (const key of ['openBankingConsentData', 'openBankingConsentVoluntary', 'openBankingConsentAdvice', 'openBankingConsentRights']) {
      expect(root.querySelector(`[data-i18n="${key}"]`)).not.toBeNull();
    }
  });
});
