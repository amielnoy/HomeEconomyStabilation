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
  });

  it('keeps the architecture aligned with the independent agent module and local trust boundary', () => {
    const architecture = read('Architecture.html');
    expect(architecture).toContain('src/financial-agents.ts');
    expect(architecture).toContain('seven independent financial agents');
    expect(architecture).toContain('no remote model call');
    expect(architecture).toContain('explicit approval');
    expect(architecture).toContain('https://github.com/amielnoy/HomeEconomyStabilation#readme');
  });

  it('documents agent states, accessibility, mobile behavior and automation selectors', () => {
    const designSystem = read('design-system.md');
    for (const requirement of [
      '.agent-card', 'quiet', 'warning', 'critical', '44×44', 'data-testid',
      'approve-learning-rule', 'apply-budget-suggestion',
    ]) expect(designSystem).toContain(requirement);
  });
});
