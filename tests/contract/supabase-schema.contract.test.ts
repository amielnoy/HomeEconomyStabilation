import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const migration = readFileSync(resolve(root, 'supabase/migrations/202608230001_create_app_snapshots.sql'), 'utf8');
const api = readFileSync(resolve(root, 'api/snapshots.ts'), 'utf8');

describe('Supabase persistence contract', () => {
  it('defines the minimal profile, snapshot and consent tables', () => {
    for (const table of ['user_profiles', 'app_snapshots', 'consent_acceptances']) {
      expect(migration).toContain(`public.${table}`);
      expect(migration).toContain(`alter table public.${table} enable row level security`);
    }
    expect(migration).toContain('on delete cascade');
    expect(migration).toContain('app_snapshots_payload_size');
  });

  it('revokes anonymous access and scopes every policy to the authenticated owner', () => {
    for (const table of ['user_profiles', 'app_snapshots', 'consent_acceptances']) {
      expect(migration).toContain(`revoke all on table public.${table} from anon, authenticated`);
    }
    expect(migration.match(/to authenticated/g)?.length).toBeGreaterThanOrEqual(10);
    expect(migration.match(/auth\.uid\(\)/g)?.length).toBeGreaterThanOrEqual(10);
  });

  it('uses only a publishable key and verifies the user token at the API boundary', () => {
    expect(api).toContain('SUPABASE_PUBLISHABLE_KEY');
    expect(api).toContain('auth.getUser(token)');
    expect(api).not.toMatch(/service[_-]?role/i);
    expect(api).not.toContain('SUPABASE_SECRET_KEY');
  });
});
