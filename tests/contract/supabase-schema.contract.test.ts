import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CLOUD_SNAPSHOT_SCHEMA_VERSION } from '../../src/cloud-sync';

const root = resolve(__dirname, '../..');
const migration = readFileSync(resolve(root, 'supabase/migrations/202608230001_create_app_snapshots.sql'), 'utf8');
const versionMigration = readFileSync(resolve(root, 'supabase/migrations/202608240001_upgrade_snapshot_schema_v2.sql'), 'utf8');
const config = readFileSync(resolve(root, 'server/config.py'), 'utf8');
const store = readFileSync(resolve(root, 'server/supabase_store.py'), 'utf8');
const supportMigration = readFileSync(resolve(root, 'supabase/migrations/202608240002_server_repository_support.sql'), 'utf8');

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
    expect(config).toContain('SUPABASE_PUBLISHABLE_KEY');
    expect(store).toContain('/auth/v1/user');
    expect(`${config}\n${store}`).not.toMatch(/service[_-]?role/i);
    expect(`${config}\n${store}`).not.toContain('SUPABASE_SECRET_KEY');
  });

  /* Every column an upsert puts in its body lands in the `on conflict do update set`
     clause PostgREST generates, so a column-level grant that omits any of them fails
     the *second* write with 42501 while the first still succeeds. The fake client the
     store tests use cannot enforce grants, so the invariant is checked against the SQL. */
  it('grants update on every column the merge-duplicates upserts send', () => {
    const upserted: Record<string, readonly string[]> = {
      user_profiles: ['user_id', 'preferred_locale'],
      app_snapshots: ['user_id', 'payload', 'schema_version'],
      consent_acceptances: ['user_id', 'purpose', 'statement_version', 'locale', 'accepted_at', 'withdrawn_at'],
    };
    const migrationsDir = resolve(root, 'supabase/migrations');
    const sql = readdirSync(migrationsDir)
      .filter((name) => name.endsWith('.sql'))
      .map((name) => readFileSync(resolve(migrationsDir, name), 'utf8'))
      .join('\n');

    const granted = new Map<string, Set<string>>();
    for (const [, columns, table] of sql.matchAll(/grant\s+update\s*\(([^)]*)\)\s*on\s+table\s+public\.(\w+)/gi)) {
      const set = granted.get(table) ?? new Set<string>();
      for (const column of columns.split(',')) set.add(column.trim());
      granted.set(table, set);
    }

    for (const [table, columns] of Object.entries(upserted)) {
      expect(store).toContain(table);
      for (const column of columns) {
        expect({ table, column, granted: [...(granted.get(table) ?? [])] })
          .toMatchObject({ granted: expect.arrayContaining([column]) });
      }
    }
  });

  it('keeps the database default and write constraint aligned with the runtime snapshot version', () => {
    expect(versionMigration).toContain(`set default ${CLOUD_SNAPSHOT_SCHEMA_VERSION}`);
    expect(versionMigration).toContain(`check (schema_version = ${CLOUD_SNAPSHOT_SCHEMA_VERSION})`);
    expect(versionMigration).toContain('not valid');
    expect(supportMigration).toContain('validate constraint app_snapshots_schema_version_check');
  });
});
