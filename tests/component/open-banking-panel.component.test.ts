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

  /* Dark by default: with no sources configured (today's production state) the trigger
     would be a dead button, so the markup ships it hidden and app.ts reveals it only once
     /api/open-banking/sources has returned at least one source. Hidden in the markup,
     not merely by script, so it never flashes on while that request is in flight and
     stays hidden if the request fails. */
  it('starts with the Connect a bank trigger hidden until a source is configured', () => {
    const html = readFileSync(resolve(__dirname, '../../fe/mazan-habait.html'), 'utf8');
    const document = new JSDOM(html).window.document;

    const trigger = document.querySelector<HTMLButtonElement>('[data-testid="open-banking-trigger"]')!;

    expect(trigger.hidden).toBe(true);
    // `.btn` sets its own display, which would beat the user agent's `[hidden]` rule;
    // the design system must restore it or the attribute would be cosmetic.
    const designSystem = readFileSync(resolve(__dirname, '../../fe/design-system.css'), 'utf8');
    expect(designSystem).toMatch(/\.btn\[hidden\][^{]*\{\s*display:\s*none;?\s*\}/);
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
