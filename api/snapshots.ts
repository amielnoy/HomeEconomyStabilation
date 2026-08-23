import { createClient } from '@supabase/supabase-js';
import {
  CLOUD_SNAPSHOT_MAX_BYTES,
  CLOUD_SNAPSHOT_SCHEMA_VERSION,
  isCloudStatePayload,
  snapshotBytes,
} from '../src/cloud-sync';

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
  if (!['GET', 'PUT', 'DELETE'].includes(request.method || '')) return error(response, 405, 'method_not_allowed');

  const config = readSupabaseConfig();
  if (!config) return error(response, 503, 'cloud_not_configured');
  const token = bearerToken(request.headers.authorization);
  if (!token) return error(response, 401, 'authentication_required');

  const supabase = createClient(config.url, config.publishableKey, {
    accessToken: async () => token,
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData.user) return error(response, 401, 'invalid_session');

  if (request.method === 'GET') {
    const { data, error: queryError } = await supabase
      .from('app_snapshots').select('payload,schema_version,updated_at').maybeSingle();
    if (queryError) return error(response, 502, 'cloud_read_failed');
    return response.status(200).json({
      snapshot: data ? { schemaVersion: data.schema_version, payload: data.payload, updatedAt: data.updated_at } : null,
    });
  }

  if (request.method === 'DELETE') {
    const { error: deleteError } = await supabase.from('app_snapshots').delete().eq('user_id', authData.user.id);
    if (deleteError) return error(response, 502, 'cloud_delete_failed');
    response.status(204).end();
    return;
  }

  const body = typeof request.body === 'string' ? (() => {
    try { return JSON.parse(request.body); } catch { return null; }
  })() : request.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return error(response, 400, 'invalid_snapshot');
  const candidate = body as Record<string, unknown>;
  if (candidate.schemaVersion !== CLOUD_SNAPSHOT_SCHEMA_VERSION || !isCloudStatePayload(candidate.payload)
      || snapshotBytes(candidate.payload) > CLOUD_SNAPSHOT_MAX_BYTES) {
    return error(response, 400, 'invalid_snapshot');
  }

  const { data, error: writeError } = await supabase.from('app_snapshots').upsert({
    user_id: authData.user.id,
    payload: candidate.payload,
    schema_version: CLOUD_SNAPSHOT_SCHEMA_VERSION,
  }, { onConflict: 'user_id' }).select('payload,schema_version,updated_at').single();
  if (writeError) return error(response, 502, 'cloud_write_failed');
  return response.status(200).json({
    snapshot: { schemaVersion: data.schema_version, payload: data.payload, updatedAt: data.updated_at },
  });
}
