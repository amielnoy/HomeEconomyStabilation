import { describe, expect, it } from 'vitest';
import { bearerToken, readSupabaseConfig } from '../../api/snapshots';

describe('Supabase API boundary', () => {
  it('fails closed for missing, privileged-looking or insecure configuration', () => {
    expect(readSupabaseConfig({})).toBeNull();
    expect(readSupabaseConfig({ SUPABASE_URL: 'http://example.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x' })).toBeNull();
    expect(readSupabaseConfig({ SUPABASE_URL: 'https://example.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_secret_x' })).toBeNull();
  });

  it('accepts only an HTTPS URL and the current publishable-key format', () => {
    expect(readSupabaseConfig({
      SUPABASE_URL: 'https://example.supabase.co/path', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example',
    })).toEqual({ url: 'https://example.supabase.co', publishableKey: 'sb_publishable_example' });
  });

  it('parses a strict bearer token and rejects ambiguous headers', () => {
    expect(bearerToken('Bearer user.jwt.token')).toBe('user.jwt.token');
    expect(bearerToken('bearer user.jwt.token')).toBeNull();
    expect(bearerToken(['Bearer one', 'Bearer two'])).toBeNull();
  });
});
