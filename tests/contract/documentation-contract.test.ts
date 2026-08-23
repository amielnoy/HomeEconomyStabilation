import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const read = (file: string) => readFileSync(resolve(root, file), 'utf8');

describe('project documentation contract', () => {
  it('documents every financial agent and both approval boundaries in the README', () => {
    const readme = read('README.md');
    for (const name of [
      'סוכן שיוך לומד', 'סוכן חריגות', 'סוכן חיובים חסרים', 'סוכן כפילויות',
      'סוכן מנויים', 'סוכן תקציב מציע', 'סוכן עד המשכורת הבאה',
    ]) expect(readme).toContain(name);
    expect(readme).toContain('אישור הכלל');
    expect(readme).toContain('התקרה נשמרת רק לאחר אישור');
    expect(readme).toContain('מצפן הוצאה');
    expect(readme).toContain('spending-guide.sanity.e2e.spec.ts');
    expect(readme).toContain('יום האחרון שקיים באותו חודש');
    expect(readme).toContain('SUPABASE_PUBLISHABLE_KEY');
    expect(readme).toContain('הצהרת ההסכמה');
  });

  it('keeps the architecture aligned with the independent agent module and local trust boundary', () => {
    const architecture = read('Architecture.html');
    expect(architecture).toContain('src/financial-agents.ts');
    expect(architecture).toContain('seven independent financial agents');
    expect(architecture).toContain('no remote model call');
    expect(architecture).toContain('explicit approval');
    expect(architecture).toContain('Safe-to-spend sanity matrix');
    expect(architecture).toContain('month-end date clamping');
    expect(architecture).toContain('SupabaseSnapshotRepository');
    expect(architecture).toContain('consent_acceptances');
    expect(architecture).toContain('https://github.com/amielnoy/HomeEconomyStabilation#readme');
  });

  it('documents agent states, accessibility, mobile behavior and automation selectors', () => {
    const designSystem = read('design-system.md');
    for (const requirement of [
      '.agent-card', 'quiet', 'warning', 'critical', '44×44', 'data-testid',
      'approve-learning-rule', 'apply-budget-suggestion', '.spending-guide', 'aria-live="polite"',
      'NaN', 'last valid day', 'iOS WebKit',
      '.consent-card', 'unchecked by default', 'cloud-consent-*',
    ]) expect(designSystem).toContain(requirement);
  });

  it('documents Supabase tables, classes, security and activation prerequisites', () => {
    const guide = read('SUPABASE.md');
    for (const requirement of [
      'user_profiles', 'app_snapshots', 'consent_acceptances', 'SupabaseSnapshotRepository',
      'LocalConsentRepository', 'auth.getUser(token)', 'RLS', 'service_role', 'integration',
    ]) expect(guide).toContain(requirement);
  });

  it('tracks account-level activation work without claiming cloud is already active', () => {
    const todo = read('TODO.md');
    for (const requirement of [
      'VERCEL_TOKEN', 'VERCEL_ORG_ID', 'VERCEL_PROJECT_ID', 'Supabase',
      'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'RLS', 'integration',
    ]) expect(todo).toContain(requirement);
    expect(todo).toContain('- [ ]');
  });
});
