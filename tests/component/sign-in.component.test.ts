import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

describe('sign-in toggle', () => {
  it('starts with both the sign-in and sign-out controls hidden', () => {
    const html = readFileSync(resolve(__dirname, '../../fe/mazan-habait.html'), 'utf8');
    const document = new JSDOM(html).window.document;

    const signIn = document.querySelector<HTMLAnchorElement>('[data-testid="sign-in-trigger"]')!;
    const signOut = document.querySelector<HTMLButtonElement>('[data-testid="sign-out-trigger"]')!;

    expect(signIn).not.toBeNull();
    expect(signIn.hidden).toBe(true);
    expect(signIn.getAttribute('href')).toBe('/api/auth/google');
    expect(signOut).not.toBeNull();
    expect(signOut.hidden).toBe(true);
  });
});
