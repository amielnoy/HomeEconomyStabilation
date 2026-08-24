import { createClient } from '@supabase/supabase-js';
import { HttpStatus } from '../src/http-status.js';
import {
  CLOUD_SNAPSHOT_MAX_BYTES,
  CLOUD_SNAPSHOT_SCHEMA_VERSION,
  isCloudStatePayload,
  snapshotBytes,
} from '../src/cloud-sync.js';
import { guardSnapshotRequest } from './request-guard.js';

interface ApiRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: unknown;
}

interface ApiResponse {
  status(code: number): ApiResponse;
  setHeader(name: string, value: string): void;
  json(body: unknown): void;
  end(): void;
}

type RuntimeEnv = Record<string, string | undefined>;
const runtimeEnv = (): RuntimeEnv =>
  (globalThis as typeof globalThis & { process?: { env?: RuntimeEnv } }).process?.env || {};

export function readSupabaseConfig(env: RuntimeEnv = runtimeEnv()) {
  const url = env.SUPABASE_URL;
  const publishableKey = env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey?.startsWith('sb_publishable_')) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
    return { url: parsed.origin, publishableKey };
  } catch {
    return null;
  }
}

export function bearerToken(header: string | string[] | undefined): string | null {
  if (typeof header !== 'string') return null;
  const match = header.match(/^Bearer ([A-Za-z0-9._~-]+)$/);
  return match?.[1] || null;
}

const error = (response: ApiResponse, status: number, code: string) =>
  response.status(status).json({ code });

export default async function handler(request: ApiRequest, response: ApiResponse) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Allow', 'GET, PUT, DELETE');
  if (!['GET', 'PUT', 'DELETE'].includes(request.method || '')) return error(response, HttpStatus.METHOD_NOT_ALLOWED, 'method_not_allowed');

  const guardFailure = guardSnapshotRequest(request);
  if (guardFailure) {
    if (guardFailure.retryAfter) response.setHeader('Retry-After', String(guardFailure.retryAfter));
    return error(response, guardFailure.status, guardFailure.code);
  }

  const body = request.method === 'PUT' ? (typeof request.body === 'string' ? (() => {
    try { return JSON.parse(request.body); } catch { return null; }
  })() : request.body) : null;
  if (request.method === 'PUT') {
    if (!body || typeof body !== 'object' || Array.isArray(body)) return error(response, HttpStatus.BAD_REQUEST, 'invalid_snapshot');
    const candidate = body as Record<string, unknown>;
    if (candidate.schemaVersion !== CLOUD_SNAPSHOT_SCHEMA_VERSION || !isCloudStatePayload(candidate.payload)
        || snapshotBytes(candidate.payload) > CLOUD_SNAPSHOT_MAX_BYTES) {
      return error(response, HttpStatus.BAD_REQUEST, 'invalid_snapshot');
    }
  }

  const config = readSupabaseConfig();
  if (!config) return error(response, HttpStatus.SERVICE_UNAVAILABLE, 'cloud_not_configured');
  const token = bearerToken(request.headers.authorization);
  if (!token) return error(response, HttpStatus.UNAUTHORIZED, 'authentication_required');

  const supabase = createClient(config.url, config.publishableKey, {
    accessToken: async () => token,
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData.user) return error(response, HttpStatus.UNAUTHORIZED, 'invalid_session');

  if (request.method === 'GET') {
    const { data, error: queryError } = await supabase
      .from('app_snapshots').select('payload,schema_version,updated_at').maybeSingle();
    if (queryError) return error(response, HttpStatus.BAD_GATEWAY, 'cloud_read_failed');
    return response.status(HttpStatus.OK).json({
      snapshot: data ? { schemaVersion: data.schema_version, payload: data.payload, updatedAt: data.updated_at } : null,
    });
  }

  if (request.method === 'DELETE') {
    const { error: deleteError } = await supabase.from('app_snapshots').delete().eq('user_id', authData.user.id);
    if (deleteError) return error(response, HttpStatus.BAD_GATEWAY, 'cloud_delete_failed');
    response.status(HttpStatus.NO_CONTENT).end();
    return;
  }

  const candidate = body as Record<string, unknown>;

  const { data, error: writeError } = await supabase.from('app_snapshots').upsert({
    user_id: authData.user.id,
    payload: candidate.payload,
    schema_version: CLOUD_SNAPSHOT_SCHEMA_VERSION,
  }, { onConflict: 'user_id' }).select('payload,schema_version,updated_at').single();
  if (writeError) return error(response, HttpStatus.BAD_GATEWAY, 'cloud_write_failed');
  return response.status(HttpStatus.OK).json({
    snapshot: { schemaVersion: data.schema_version, payload: data.payload, updatedAt: data.updated_at },
  });
}
