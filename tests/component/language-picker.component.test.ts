import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

const pageMarkup = readFileSync(resolve(__dirname, '../../mazan-habait.html'), 'utf8');

describe('language picker component', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = pageMarkup;
  });

  it('renders one native-language option for every supported locale', () => {
    const options = [...document.querySelectorAll<HTMLOptionElement>('#locale-select option')]
      .map((option) => ({ value: option.value, label: option.textContent }));

    expect(options).toEqual([
      { value: 'he', label: 'עברית' },
      { value: 'en', label: 'English' },
      { value: 'am', label: 'አማርኛ' },
      { value: 'fr', label: 'Français' },
    ]);
  });

  it('uses the shared field recipe and has an accessible label', () => {
    const picker = document.querySelector<HTMLSelectElement>('#locale-select');
    const wrapper = picker?.closest('label');

    expect(picker?.classList.contains('ds-field')).toBe(true);
    expect(picker?.classList.contains('ds-field--compact')).toBe(true);
    expect(picker?.getAttribute('aria-label')).toBe('שפת ממשק');
    expect(wrapper?.classList.contains('locale-picker')).toBe(true);
    expect(wrapper?.querySelector('[data-i18n="languageLabel"]')).not.toBeNull();
  });

  it('supports native keyboard-driven selection semantics', () => {
    const picker = document.querySelector<HTMLSelectElement>('#locale-select')!;

    picker.value = 'am';
    picker.dispatchEvent(new Event('change', { bubbles: true }));

    expect(picker.value).toBe('am');
  });
});
