/* What `/api/auth/session` says about this browser, and which controls that permits.

   Two separate facts, never folded together: whether sign-in exists on this deployment
   at all (`available` — the cloud is configured), and whether this browser holds a
   session the server recognizes (`signedIn`). A sign-in button shown where the cloud is
   not configured would only ever lead to a 503, so it is a dead control. */
export interface SignInState {
  available: boolean;
  signedIn: boolean;
}

/* Anything other than an explicit `true` is `false`: a failed request, a malformed body
   or an error payload all leave every auth-dependent control hidden. */
export function readSignInState(body: unknown): SignInState {
  if (!body || typeof body !== 'object') return { available: false, signedIn: false };
  const { available, signedIn } = body as Record<string, unknown>;
  return { available: available === true, signedIn: signedIn === true };
}

export function signInControls(state: SignInState): { showSignIn: boolean; showSignOut: boolean } {
  return { showSignIn: state.available && !state.signedIn, showSignOut: state.signedIn };
}

export function applySignInControls(root: ParentNode, state: SignInState): void {
  const { showSignIn, showSignOut } = signInControls(state);
  const signIn = root.querySelector<HTMLElement>('#btn-sign-in');
  const signOut = root.querySelector<HTMLElement>('#btn-sign-out');
  if (signIn) signIn.hidden = !showSignIn;
  if (signOut) signOut.hidden = !showSignOut;
}

/* The connect-a-bank trigger and its panel share one condition: with no source, or no
   session, every control in them (Connect, Sync, Disconnect) would only answer 401. */
export function openBankingAvailable(sourceCount: number, signedIn: boolean): boolean {
  return sourceCount > 0 && signedIn;
}
