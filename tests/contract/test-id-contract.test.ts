import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');
const html = readFileSync(resolve(root, 'mazan-habait.html'), 'utf8');
const document = new JSDOM(html).window.document;

describe('automation test-id contract', () => {
  it('gives every named application element a stable data-testid', () => {
    const missing = [...document.querySelectorAll<HTMLElement>('[id]')]
      .filter((element) => !element.dataset.testid)
      .map((element) => `${element.tagName.toLowerCase()}#${element.id}`);

    expect(missing).toEqual([]);
  });

  it('gives every interactive application element a stable data-testid', () => {
    const missing = [...document.querySelectorAll<HTMLElement>('button, input, select, a[href], label.btn')]
      .filter((element) => !element.dataset.testid)
      .map((element) => element.outerHTML.slice(0, 140));

    expect(missing).toEqual([]);
  });

  it('publishes test ids for dynamic collections and their actions', () => {
    const source = readFileSync(resolve(root, 'src/app.ts'), 'utf8');
    for (const testId of [
      'month-chip', 'attention-item', 'recommendation-card', 'recommendation-action',
      'budget-row', 'category-row', 'recurring-row', 'transaction-row',
      'transaction-balance', 'transaction-category-select', 'budget-limit-input',
      'rule-match-input', 'rule-category-select', 'category-name-input', 'category-type-select',
      'approve-learning-rule', 'apply-budget-suggestion',
    ]) {
      expect(source, `missing dynamic data-testid ${testId}`).toContain(`'data-testid': '${testId}'`);
    }
  });

  it('keeps Page Objects on the public test-id contract', () => {
    const pageObjectRoot = resolve(root, 'tests/e2e/page-objects');
    const files = [
      ...readdirSync(pageObjectRoot).filter((file) => file.endsWith('.ts')).map((file) => resolve(pageObjectRoot, file)),
      ...readdirSync(resolve(pageObjectRoot, 'components')).filter((file) => file.endsWith('.ts'))
        .map((file) => resolve(pageObjectRoot, 'components', file)),
    ];

    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      expect(source, `${file} should use getByTestId instead of page.locator`).not.toContain('page.locator(');
    }
  });
});
