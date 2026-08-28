import { describe, expect, it } from 'vitest';
import { LOG_KEY_PREFIX, Logger, resolveLevel, type LogRecord, type LogStorage } from '../../src/logging';

/* A stand-in for localStorage that can also be made to run out of room, which is the case
   that decides whether the log or the customer's financial state survives. */
const memoryStorage = (options: { failAfter?: number } = {}) => {
  const map = new Map<string, string>();
  let writes = 0;
  const storage: LogStorage & { map: Map<string, string> } = {
    map,
    get length() { return map.size; },
    key: (index: number) => [...map.keys()][index] ?? null,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      writes += 1;
      if (options.failAfter !== undefined && writes > options.failAfter) {
        throw new DOMException('quota', 'QuotaExceededError');
      }
      map.set(key, value);
    },
    removeItem: (key: string) => { map.delete(key); },
  };
  return storage;
};

const sink = () => {
  const calls: Array<[string, unknown[]]> = [];
  const record = (level: string) => (...args: unknown[]) => { calls.push([level, args]); };
  return {
    calls,
    console: { debug: record('debug'), info: record('info'), warn: record('warn'), error: record('error') },
  };
};

const at = (iso: string) => () => new Date(iso);

describe('browser logger', () => {
  it('writes the shared record shape', () => {
    const logger = new Logger({ now: at('2026-08-28T09:15:00.000Z') });

    logger.info('report.read', { format: 'xlsx', sheets: 2 });

    expect(logger.entries()).toEqual<LogRecord[]>([{
      ts: '2026-08-28T09:15:00.000Z',
      level: 'info',
      source: 'web',
      event: 'report.read',
      context: { format: 'xlsx', sheets: 2 },
    }]);
  });

  it('keeps records below the configured level out of the log', () => {
    const logger = new Logger({ level: 'warn' });

    logger.debug('a');
    logger.info('b');
    logger.warn('c');
    logger.error('d');

    expect(logger.entries().map((entry) => entry.event)).toEqual(['c', 'd']);
  });

  /* A tab left open all day must not grow without limit, and when something finally goes
     wrong the records worth having are the most recent ones. */
  it('drops the oldest records once the buffer is full', () => {
    const logger = new Logger({ capacity: 3 });

    for (const event of ['one', 'two', 'three', 'four', 'five']) logger.info(event);

    expect(logger.entries().map((entry) => entry.event)).toEqual(['three', 'four', 'five']);
  });

  /* The log is a file the customer is asked to send. An account number reaching it would
     put the identifier the product promises not to keep into a second place. */
  it('redacts financial identifiers in any logged string', () => {
    const logger = new Logger();

    logger.info('report.read', { note: 'חשבון 04-279-661711 נטען', card: '4580 1234 5678 9012' });

    const context = logger.entries()[0]!.context!;
    expect(context.note).not.toContain('04-279-661711');
    expect(context.card).not.toContain('4580');
  });

  /* A transaction passed by accident must not become a log line carrying a merchant and
     an amount, so structured values are refused rather than serialised. */
  it('refuses to log a structured value', () => {
    const logger = new Logger();

    logger.info('oops', { transaction: { desc: 'שופרסל', out: 431 } });

    expect(logger.entries()[0]!.context).toEqual({ transaction: '[unloggable]' });
  });

  it('mirrors records to the console at the matching level', () => {
    const spy = sink();
    const logger = new Logger({ console: spy.console });

    logger.warn('report.import.rejected', { reason: 'columns-unrecognised' });

    expect(spy.calls).toHaveLength(1);
    expect(spy.calls[0]![0]).toBe('warn');
  });

  it('serialises the buffer as JSON lines', () => {
    const logger = new Logger({ now: at('2026-08-28T09:15:00.000Z') });
    logger.info('one');
    logger.info('two');

    const lines = logger.toText().split('\n');

    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).event).toBe('one');
    expect(JSON.parse(lines[1]!).source).toBe('web');
  });

  it('silences every level when asked', () => {
    const logger = new Logger({ level: 'silent' });

    logger.error('report.import.failed');

    expect(logger.entries()).toEqual([]);
  });

  /* The browser's answer to a rotated log file: one key per day, so a problem reported the
     morning after still has the records that describe it. */
  it('keeps a dated copy of the day it was written', () => {
    const storage = memoryStorage();
    const logger = new Logger({ storage, now: at('2026-08-28T09:15:00.000Z') });

    logger.info('report.read');
    logger.flush();

    expect(storage.getItem(`${LOG_KEY_PREFIX}2026-08-28`)).toContain('report.read');
  });

  it('starts a new copy when a tab is left open past midnight', () => {
    const storage = memoryStorage();
    let clock = new Date('2026-08-28T23:59:59.000Z');
    const logger = new Logger({ storage, now: () => clock });

    logger.info('before.midnight');
    clock = new Date('2026-08-29T00:00:01.000Z');
    logger.info('after.midnight');
    logger.flush();

    expect(storage.getItem(`${LOG_KEY_PREFIX}2026-08-28`)).toContain('before.midnight');
    expect(storage.getItem(`${LOG_KEY_PREFIX}2026-08-29`)).toContain('after.midnight');
    expect(storage.getItem(`${LOG_KEY_PREFIX}2026-08-29`)).not.toContain('before.midnight');
  });

  /* Retention is applied when a tab opens, because a tab that is never opened cannot run
     a cleanup of its own. */
  it('drops copies older than the retention window', () => {
    const storage = memoryStorage();
    for (const day of ['2026-08-20', '2026-08-26', '2026-08-27', '2026-08-28']) {
      storage.setItem(`${LOG_KEY_PREFIX}${day}`, '{}');
    }

    new Logger({ storage, retentionDays: 3, now: at('2026-08-28T09:00:00.000Z') });

    expect([...storage.map.keys()].sort()).toEqual([
      `${LOG_KEY_PREFIX}2026-08-26`, `${LOG_KEY_PREFIX}2026-08-27`, `${LOG_KEY_PREFIX}2026-08-28`,
    ]);
  });

  it('reads the retained days back oldest first', () => {
    const storage = memoryStorage();
    storage.setItem(`${LOG_KEY_PREFIX}2026-08-27`, '{"event":"yesterday"}');
    const logger = new Logger({ storage, now: at('2026-08-28T09:00:00.000Z') });

    logger.info('today');

    const lines = logger.archive().split('\n');
    expect(lines[0]).toContain('yesterday');
    expect(lines[1]).toContain('today');
  });

  /* Storage is shared with the customer's transactions. If the log cannot be written, the
     log is what gives way — never the state. */
  it('gives storage back instead of failing when there is no room', () => {
    const storage = memoryStorage({ failAfter: 1 });
    storage.setItem(`${LOG_KEY_PREFIX}2026-08-27`, 'older');
    const logger = new Logger({ storage, now: at('2026-08-28T09:00:00.000Z') });

    expect(() => { logger.info('today'); logger.flush(); }).not.toThrow();
    expect(storage.getItem(`${LOG_KEY_PREFIX}2026-08-27`)).toBeNull();
  });

  it('stays in memory when no storage is offered', () => {
    const logger = new Logger({ now: at('2026-08-28T09:00:00.000Z') });

    logger.info('only.in.memory');

    expect(logger.archive()).toContain('only.in.memory');
  });

  /* Support asks a customer to reproduce a problem, not to rebuild the application. */
  it('takes the level from the query string, then from what was stored', () => {
    expect(resolveLevel('?log=debug', null)).toBe('debug');
    expect(resolveLevel('', 'warn')).toBe('warn');
    expect(resolveLevel('?log=debug', 'warn')).toBe('debug');
  });

  it('falls back to info for a level nobody defined', () => {
    expect(resolveLevel('?log=verbose', null)).toBe('info');
    expect(resolveLevel('', null)).toBe('info');
  });
});
