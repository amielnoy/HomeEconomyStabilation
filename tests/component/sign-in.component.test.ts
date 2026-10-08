import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { applySignInControls, readSignInState } from '../../fe/src/sign-in-state';

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

  /* Production today has no Supabase configured: `/api/auth/session` answers
     `available: false`, and a sign-in link there would only ever lead to a 503. */
  it('keeps the sign-in control hidden when sign-in is not available on this deployment', () => {
    const document = markup();
    applySignInControls(document, { available: false, signedIn: false });

    expect(document.querySelector<HTMLElement>('[data-testid="sign-in-trigger"]')!.hidden).toBe(true);
    expect(document.querySelector<HTMLElement>('[data-testid="sign-out-trigger"]')!.hidden).toBe(true);
  });

  it('reveals only the sign-in control to a signed-out browser where sign-in is available', () => {
    const document = markup();
    applySignInControls(document, { available: true, signedIn: false });

    expect(document.querySelector<HTMLElement>('[data-testid="sign-in-trigger"]')!.hidden).toBe(false);
    expect(document.querySelector<HTMLElement>('[data-testid="sign-out-trigger"]')!.hidden).toBe(true);
  });

  it('reveals only the sign-out control to a signed-in browser', () => {
    const document = markup();
    applySignInControls(document, { available: true, signedIn: true });

    expect(document.querySelector<HTMLElement>('[data-testid="sign-in-trigger"]')!.hidden).toBe(true);
    expect(document.querySelector<HTMLElement>('[data-testid="sign-out-trigger"]')!.hidden).toBe(false);
  });

  it('keeps both controls hidden when the session request failed', () => {
    const document = markup();
    applySignInControls(document, readSignInState(null));

    expect(document.querySelector<HTMLElement>('[data-testid="sign-in-trigger"]')!.hidden).toBe(true);
    expect(document.querySelector<HTMLElement>('[data-testid="sign-out-trigger"]')!.hidden).toBe(true);
  });
});

function markup(): Document {
  const html = readFileSync(resolve(__dirname, '../../fe/mazan-habait.html'), 'utf8');
  return new JSDOM(html).window.document;
}
