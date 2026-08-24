import { HttpStatus } from '../src/http-status.js';

interface GuardRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
}

export interface GuardFailure { status: number; code: string; retryAfter?: number }

const WINDOW_MS = 60_000;
const MAX_REQUESTS = 60;
const MAX_TRACKED_CLIENTS = 10_000;
const MAX_REQUEST_BYTES = 1_010_000;
const buckets = new Map<string, { count: number; resetsAt: number }>();

const firstHeader = (value: string | string[] | undefined): string | null =>
  typeof value === 'string' ? value : value?.[0] ?? null;

function clientKey(request: GuardRequest): string {
  const forwarded = firstHeader(request.headers['x-vercel-forwarded-for'])
    || firstHeader(request.headers['x-forwarded-for']);
  return forwarded?.split(',')[0]?.trim().slice(0, 100) || 'unknown';
}

function rateLimit(request: GuardRequest, now: number): GuardFailure | null {
  const key = clientKey(request);
  const current = buckets.get(key);
  if (!current || current.resetsAt <= now) {
    if (buckets.size >= MAX_TRACKED_CLIENTS) {
      for (const [candidate, bucket] of buckets) if (bucket.resetsAt <= now) buckets.delete(candidate);
      if (buckets.size >= MAX_TRACKED_CLIENTS) buckets.delete(buckets.keys().next().value as string);
    }
    buckets.set(key, { count: 1, resetsAt: now + WINDOW_MS });
    return null;
  }
  current.count += 1;
  if (current.count <= MAX_REQUESTS) return null;
  return { status: HttpStatus.TOO_MANY_REQUESTS, code: 'rate_limited', retryAfter: Math.ceil((current.resetsAt - now) / 1000) };
}

export function guardSnapshotRequest(request: GuardRequest, now = Date.now()): GuardFailure | null {
  const rateFailure = rateLimit(request, now);
  if (rateFailure) return rateFailure;
  if (request.method !== 'PUT') return null;
  const contentType = firstHeader(request.headers['content-type']);
  if (!contentType?.toLowerCase().startsWith('application/json')) {
    return { status: HttpStatus.UNSUPPORTED_MEDIA_TYPE, code: 'json_content_type_required' };
  }
  const contentLength = Number(firstHeader(request.headers['content-length']));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return { status: HttpStatus.CONTENT_TOO_LARGE, code: 'snapshot_too_large' };
  }
  return null;
}

export function resetRequestGuardForTests(): void { buckets.clear(); }
