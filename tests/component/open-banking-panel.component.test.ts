import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

describe('open banking connect panel', () => {
  it('shows a Connect a bank trigger beside the existing import buttons', () => {
    const html = readFileSync(resolve(__dirname, '../../fe/mazan-habait.html'), 'utf8');
    const document = new JSDOM(html).window.document;

    const trigger = document.querySelector<HTMLButtonElement>('[data-testid="open-banking-trigger"]')!;
    const cardTrigger = document.querySelector('[data-testid="card-upload-trigger"]')!;

    expect(trigger).not.toBeNull();
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog');
    expect(trigger.querySelector('[data-i18n="openBankingConnect"]')).not.toBeNull();
    // Beside the existing import buttons: same parent, same toolbar.
    expect(trigger.parentElement).toBe(cardTrigger.parentElement);
  });

  it('starts with the connections panel hidden and empty', () => {
    const html = readFileSync(resolve(__dirname, '../../fe/mazan-habait.html'), 'utf8');
    const document = new JSDOM(html).window.document;

    const panel = document.querySelector<HTMLElement>('[data-testid="open-banking-panel"]')!;

    expect(panel).not.toBeNull();
    expect(panel.hidden).toBe(true);
    expect(panel.textContent?.trim()).toBe('');
  });
});
