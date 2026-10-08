import { describe, expect, it } from 'vitest';
import { openBankingAvailable, readSignInState, signInControls } from '../../fe/src/sign-in-state';

describe('reading /api/auth/session', () => {
  it('keeps both facts apart', () => {
    expect(readSignInState({ signedIn: false, available: false })).toEqual({ signedIn: false, available: false });
    expect(readSignInState({ signedIn: false, available: true })).toEqual({ signedIn: false, available: true });
    expect(readSignInState({ signedIn: true, available: true })).toEqual({ signedIn: true, available: true });
  });

  it('fails safe on a failed request, a malformed body or an error payload', () => {
    for (const body of [null, undefined, 'signedIn', 42, [], { code: 'internal_error' }, { signedIn: 'true', available: 'true' }]) {
      expect(readSignInState(body)).toEqual({ signedIn: false, available: false });
    }
  });
});

describe('sign-in controls', () => {
  it('hides the sign-in button when sign-in is not available, even though the browser is signed out', () => {
    expect(signInControls({ available: false, signedIn: false })).toEqual({ showSignIn: false, showSignOut: false });
  });

  it('offers sign-in only when it is available and the browser is signed out', () => {
    expect(signInControls({ available: true, signedIn: false })).toEqual({ showSignIn: true, showSignOut: false });
  });

  it('offers sign-out, not sign-in, to a signed-in browser', () => {
    expect(signInControls({ available: true, signedIn: true })).toEqual({ showSignIn: false, showSignOut: true });
  });

  it('shows neither control when the session request failed entirely', () => {
    expect(signInControls(readSignInState(null))).toEqual({ showSignIn: false, showSignOut: false });
  });
});

describe('open banking trigger and panel', () => {
  it('stay hidden for a signed-out browser even when sources are configured', () => {
    expect(openBankingAvailable(2, false)).toBe(false);
  });

  it('stay hidden with no source configured, signed in or not', () => {
    expect(openBankingAvailable(0, true)).toBe(false);
    expect(openBankingAvailable(0, false)).toBe(false);
  });

  it('show only with a source and a session', () => {
    expect(openBankingAvailable(1, true)).toBe(true);
  });
});
