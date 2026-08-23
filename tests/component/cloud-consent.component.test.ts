import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

describe('cloud consent component', () => {
  it('requires an unselected explicit choice and explains data, voluntariness, limits and rights', () => {
    const html = readFileSync(resolve(__dirname, '../../mazan-habait.html'), 'utf8');
    const document = new JSDOM(html).window.document;
    const root = document.querySelector('[data-testid="cloud-consent"]')!;
    const checkbox = root.querySelector<HTMLInputElement>('[data-testid="cloud-consent-check"]')!;
    const button = root.querySelector<HTMLButtonElement>('[data-testid="cloud-consent-accept"]')!;

    expect(root.getAttribute('aria-labelledby')).toBe('cloud-consent-heading');
    expect(checkbox.checked).toBe(false);
    expect(button.disabled).toBe(true);
    for (const key of ['cloudConsentData', 'cloudConsentVoluntary', 'cloudConsentAdvice', 'cloudConsentRights']) {
      expect(root.querySelector(`[data-i18n="${key}"]`)).not.toBeNull();
    }
  });
});
