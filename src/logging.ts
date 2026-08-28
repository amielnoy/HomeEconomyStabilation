import { redactFinancialIdentifiers } from './privacy.js';

/* A diagnostic trail for an application whose data never leaves the device. That
   constraint decides the design twice over.

   A browser cannot write a file, so "the log file" here is a bounded in-memory buffer the
   customer can download and send when they report a problem. Unbounded logging in a tab
   that stays open for hours is a leak, so the buffer is a ring: the newest records evict
   the oldest, and memory use is fixed whatever happens.

   The second constraint is what may be written at all. A log that records merchant names,
   amounts or account numbers is the statement itself in another file, and would break the
   promise the product is built on. So records carry what happened — the format detected,
   which columns matched, how many rows were added — and never the values. Every string
   still passes through the same redaction the persistence boundary uses, because the
   defence has to hold for the record nobody thought about. */

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'silent'] as const;
export type LogLevel = typeof LOG_LEVELS[number];

const SEVERITY: Readonly<Record<LogLevel, number>> = {
  debug: 10, info: 20, warn: 30, error: 40, silent: 100,
};

/** One line of the shared format. The API writes the same shape, so a browser log and a
    server log can be read together, sorted by `ts`, and told apart by `source`. */
export interface LogRecord {
  readonly ts: string;
  readonly level: Exclude<LogLevel, 'silent'>;
  readonly source: 'web';
  /** A dotted, bounded name — never interpolated from data. */
  readonly event: string;
  readonly context?: Readonly<Record<string, unknown>>;
}

/** Only the handful of members used here, so a test can pass a plain object. */
export type LogStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;

export interface LoggerOptions {
  readonly level?: LogLevel;
  readonly capacity?: number;
  readonly console?: Pick<Console, 'debug' | 'info' | 'warn' | 'error'>;
  readonly now?: () => Date;
  /** Where the daily copy is kept. Omitted, the log lives only in memory. */
  readonly storage?: LogStorage | null;
  /** How many dated copies to keep, today included. */
  readonly retentionDays?: number;
}

/* Long enough to hold a whole session's worth of actions and an import, short enough that
   the download stays readable and the memory cost stays flat. */
const DEFAULT_CAPACITY = 500;

/* The browser's answer to rotation: one key per day, oldest pruned. Three days covers "it
   worked yesterday" without turning the log into a place data accumulates. */
export const LOG_KEY_PREFIX = 'mazan-habait.log.';
const DEFAULT_RETENTION_DAYS = 3;

/* Storage is shared with the customer's actual financial state. Writing the log more often
   than this would serialise the whole buffer on every click for no benefit, and the state
   is what must never be crowded out. */
const PERSIST_INTERVAL_MS = 1_000;

const dayOf = (date: Date): string => date.toISOString().slice(0, 10);

/* A value only reaches the log after this. Strings are redacted, numbers and booleans are
   safe as they are, and anything structured is dropped rather than guessed at: a
   transaction object passed by accident must not become a log line. */
function safeValue(value: unknown): unknown {
  if (typeof value === 'string') return redactFinancialIdentifiers(value);
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean' || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(safeValue);
  return '[unloggable]';
}

function safeContext(context: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!context) return undefined;
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) safe[key] = safeValue(value);
  return Object.keys(safe).length ? safe : undefined;
}

export class Logger {
  private readonly records: LogRecord[] = [];
  private readonly capacity: number;
  private readonly sink: Pick<Console, 'debug' | 'info' | 'warn' | 'error'> | null;
  private readonly now: () => Date;
  private readonly storage: LogStorage | null;
  private readonly retentionDays: number;
  private level: LogLevel;
  private day: string;
  private lastPersisted = 0;

  constructor(options: LoggerOptions = {}) {
    this.level = options.level ?? 'info';
    this.capacity = Math.max(1, options.capacity ?? DEFAULT_CAPACITY);
    this.sink = options.console ?? null;
    this.now = options.now ?? (() => new Date());
    this.storage = options.storage ?? null;
    this.retentionDays = Math.max(1, options.retentionDays ?? DEFAULT_RETENTION_DAYS);
    this.day = dayOf(this.now());
    this.prune();
  }

  setLevel(level: LogLevel): void { this.level = level; }

  getLevel(): LogLevel { return this.level; }

  isEnabled(level: Exclude<LogLevel, 'silent'>): boolean {
    return SEVERITY[level] >= SEVERITY[this.level];
  }

  debug(event: string, context?: Record<string, unknown>): void { this.write('debug', event, context); }

  info(event: string, context?: Record<string, unknown>): void { this.write('info', event, context); }

  warn(event: string, context?: Record<string, unknown>): void { this.write('warn', event, context); }

  error(event: string, context?: Record<string, unknown>): void { this.write('error', event, context); }

  /** Newest last, which is the order the download and the console already show. */
  entries(): readonly LogRecord[] { return [...this.records]; }

  clear(): void { this.records.length = 0; }

  /** JSON Lines: one record per line, so the file greps and streams like the server's. */
  toText(): string {
    return this.records.map((record) => JSON.stringify(record)).join('\n');
  }

  /** Today's records plus the dated copies still retained, oldest day first. */
  archive(): string {
    if (!this.storage) return this.toText();
    this.flush();
    const days = this.storedDays().sort();
    return days.map((day) => this.storage!.getItem(LOG_KEY_PREFIX + day) ?? '').filter(Boolean).join('\n');
  }

  /** Write today's copy now, whatever the interval says. */
  flush(): void {
    if (!this.storage) return;
    this.lastPersisted = this.now().getTime();
    const text = this.toText();
    try {
      if (text) this.storage.setItem(LOG_KEY_PREFIX + this.day, text);
    } catch {
      /* Storage is shared with the customer's financial state, and the state is what must
         survive. Rather than fail the click that triggered the record, give the space back
         by dropping the older copies and leave today's unwritten. */
      this.dropStoredDays(this.storedDays().filter((day) => day !== this.day));
    }
  }

  private storedDays(): string[] {
    if (!this.storage) return [];
    const days: string[] = [];
    for (let index = 0; index < this.storage.length; index += 1) {
      const key = this.storage.key(index);
      if (key?.startsWith(LOG_KEY_PREFIX)) days.push(key.slice(LOG_KEY_PREFIX.length));
    }
    return days;
  }

  private dropStoredDays(days: readonly string[]): void {
    for (const day of days) this.storage?.removeItem(LOG_KEY_PREFIX + day);
  }

  /* Retention, applied on the way in rather than on a timer: a tab that is never opened
     cannot run a cleanup, so the copies are pruned the next time one is. */
  private prune(): void {
    if (!this.storage) return;
    const kept = new Set(Array.from({ length: this.retentionDays }, (_, offset) => {
      const date = new Date(this.now().getTime() - offset * 86_400_000);
      return dayOf(date);
    }));
    this.dropStoredDays(this.storedDays().filter((day) => !kept.has(day)));
  }

  /* A tab left open past midnight starts a new day's copy rather than growing yesterday's,
     which is what makes the dated files line up with the server's. */
  private rollDay(at: Date): void {
    const today = dayOf(at);
    if (today === this.day) return;
    this.flush();
    this.day = today;
    this.records.length = 0;
    this.prune();
  }

  private write(level: Exclude<LogLevel, 'silent'>, event: string, context?: Record<string, unknown>): void {
    if (!this.isEnabled(level)) return;
    const at = this.now();
    this.rollDay(at);
    const record: LogRecord = {
      ts: at.toISOString(),
      level,
      source: 'web',
      event,
      ...(safeContext(context) ? { context: safeContext(context) } : {}),
    };
    this.records.push(record);
    /* The ring: dropping from the front keeps the newest records, which are the ones that
       describe whatever just went wrong. */
    if (this.records.length > this.capacity) this.records.splice(0, this.records.length - this.capacity);
    this.sink?.[level](`[${record.event}]`, record.context ?? '');
    if (this.storage && at.getTime() - this.lastPersisted >= PERSIST_INTERVAL_MS) this.flush();
  }
}

/* Support asks a customer to reproduce the problem, not to rebuild the application, so the
   level has to be reachable at runtime: ?log=debug for one visit, and a stored level for a
   problem that only shows up after a reload. */
export function resolveLevel(search: string, stored: string | null, fallback: LogLevel = 'info'): LogLevel {
  const requested = new URLSearchParams(search).get('log') ?? stored;
  return LOG_LEVELS.includes(requested as LogLevel) ? requested as LogLevel : fallback;
}
