import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, beforeEach } from 'vitest';

const pageMarkup = readFileSync(resolve(__dirname, '../../mazan-habait.html'), 'utf8');

describe('credit-card upload component', () => {
  beforeEach(() => {
    document.body.innerHTML = pageMarkup;
  });

  it('renders a multi-file card report input with spreadsheet formats', () => {
    const input = document.querySelector<HTMLInputElement>('[data-testid="card-file"]');

    expect(input).not.toBeNull();
    expect(input?.type).toBe('file');
    expect(input?.multiple).toBe(true);
    expect(input?.accept).toContain('.xls');
    expect(input?.accept).toContain('.xlsx');
    expect(input?.accept).toContain('.csv');
  });
});
