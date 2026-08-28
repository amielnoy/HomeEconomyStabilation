import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOG_LEVELS, Logger } from '../../src/logging';

/* The browser and the API write the same record so that a log downloaded from a tab and a
   log pulled off the server can be concatenated, sorted by `ts` and read as one story.
   Nothing at runtime enforces that — the two are written in different languages and never
   import each other — so the agreement is checked here, where a rename on one side fails
   before it silently splits the format in two. */

const root = resolve(__dirname, '../..');
const pythonSource = readFileSync(resolve(root, 'server/logging_config.py'), 'utf8');

describe('logging format contract', () => {
  it('writes the same fields on both sides', () => {
    const logger = new Logger();
    logger.info('http.request', { route: 'health' });
    const record = logger.entries()[0]!;

    expect(Object.keys(record).sort()).toEqual(['context', 'event', 'level', 'source', 'ts']);
    for (const field of ['"ts"', '"level"', '"source"', '"event"', '"context"']) {
      expect(pythonSource, `the API does not write ${field}`).toContain(field);
    }
  });

  it('names the same levels on both sides', () => {
    const browserLevels = LOG_LEVELS.filter((level) => level !== 'silent');

    expect(browserLevels).toEqual(['debug', 'info', 'warn', 'error']);
    for (const level of browserLevels) {
      expect(pythonSource, `the API does not name the ${level} level`).toContain(`"${level}"`);
    }
    /* Python calls it WARNING; the file has to translate rather than emit a level name the
       browser never writes. */
    expect(pythonSource).toContain('"warn" if level == "warning" else level');
  });

  it('distinguishes the two origins by the same field', () => {
    const logger = new Logger();
    logger.info('anything');

    expect(logger.entries()[0]!.source).toBe('web');
    expect(pythonSource).toContain('"source": "api"');
  });

  /* One record per line is what lets the file be grepped, tailed and streamed. A record
     containing a raw newline would break every one of those. */
  it('emits one line per record on both sides', () => {
    const logger = new Logger();
    logger.info('first', { note: 'a\nb' });
    logger.info('second');

    expect(logger.toText().split('\n')).toHaveLength(2);
    expect(pythonSource).toContain('json.dumps');
  });

  /* Rotation is the difference between a diagnostic and an outage: the browser evicts the
     oldest records from a fixed ring, the server rolls files and drops the oldest. */
  it('bounds how much either side can ever hold', () => {
    const logger = new Logger({ capacity: 2 });
    logger.info('a');
    logger.info('b');
    logger.info('c');

    expect(logger.entries()).toHaveLength(2);
    expect(pythonSource).toContain('RotatingFileHandler');
    expect(pythonSource).toContain('_MAX_BYTES');
    expect(pythonSource).toContain('_BACKUP_COUNT');
  });

  it('lets the level be raised without a rebuild on either side', () => {
    expect(readFileSync(resolve(root, 'src/logging.ts'), 'utf8')).toContain('resolveLevel');
    expect(pythonSource).toContain('LOG_LEVEL');
    expect(pythonSource).toContain('LOG_FILE');
  });
});
