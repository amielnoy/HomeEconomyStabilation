import { describe, expect, it } from 'vitest';
import { bearerToken, readSupabaseConfig } from '../../api/snapshots';
import { HttpStatus } from '../../src/http-status';

describe('Supabase API boundary', () => {
  it('centralizes the REST response codes used by the API boundary', () => {
    expect(HttpStatus.OK).toBe(200);
    expect(HttpStatus.NO_CONTENT).toBe(204);
    expect(HttpStatus.BAD_REQUEST).toBe(400);
    expect(HttpStatus.UNAUTHORIZED).toBe(401);
    expect(HttpStatus.NOT_FOUND).toBe(404);
    expect(HttpStatus.METHOD_NOT_ALLOWED).toBe(405);
    expect(HttpStatus.CONTENT_TOO_LARGE).toBe(413);
    expect(HttpStatus.UNSUPPORTED_MEDIA_TYPE).toBe(415);
    expect(HttpStatus.TOO_MANY_REQUESTS).toBe(429);
    expect(HttpStatus.INTERNAL_SERVER_ERROR).toBe(500);
    expect(HttpStatus.BAD_GATEWAY).toBe(502);
    expect(HttpStatus.SERVICE_UNAVAILABLE).toBe(503);
    expect(HttpStatus.GATEWAY_TIMEOUT).toBe(504);
  });

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
