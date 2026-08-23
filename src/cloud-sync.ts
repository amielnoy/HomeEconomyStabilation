export const CLOUD_SNAPSHOT_SCHEMA_VERSION = 1;
export const CLOUD_SNAPSHOT_MAX_BYTES = 1_000_000;

export interface CloudStatePayload {
  tx: unknown[];
  overrides: Record<string, unknown>;
  rules: unknown[];
  cats: unknown[];
  budgets: Record<string, unknown>;
  accounts: unknown[];
}

export interface CloudSnapshot {
  schemaVersion: typeof CLOUD_SNAPSHOT_SCHEMA_VERSION;
  payload: CloudStatePayload;
  updatedAt?: string;
}

export interface CloudSnapshotClient {
  load(): Promise<CloudSnapshot | null>;
  save(payload: CloudStatePayload): Promise<CloudSnapshot>;
  remove(): Promise<void>;
}

export class CloudSyncError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 0) {
    super(message);
    this.name = 'CloudSyncError';
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export function isCloudStatePayload(value: unknown): value is CloudStatePayload {
  if (!isRecord(value)) return false;
  return Array.isArray(value.tx) && value.tx.length <= 50_000
    && isRecord(value.overrides)
    && Array.isArray(value.rules) && value.rules.length <= 1_000
    && Array.isArray(value.cats) && value.cats.length <= 1_000
    && isRecord(value.budgets)
    && Array.isArray(value.accounts) && value.accounts.length <= 100;
}

export function snapshotBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export class SupabaseSnapshotRepository implements CloudSnapshotClient {
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly input: {
    accessToken: () => Promise<string | null>;
    endpoint?: string;
    fetchImpl?: typeof fetch;
  }) {
    this.endpoint = input.endpoint || '/api/snapshots';
    this.fetchImpl = input.fetchImpl || fetch;
  }

  private async request(method: 'GET' | 'PUT' | 'DELETE', payload?: CloudStatePayload) {
    const token = await this.input.accessToken();
    if (!token) throw new CloudSyncError('authentication_required', 'Sign in before using cloud sync.', 401);
    if (payload && (!isCloudStatePayload(payload) || snapshotBytes(payload) > CLOUD_SNAPSHOT_MAX_BYTES)) {
      throw new CloudSyncError('invalid_snapshot', 'The snapshot is invalid or too large.', 400);
    }
    const response = await this.fetchImpl(this.endpoint, {
      method,
      credentials: 'omit',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(payload ? { 'Content-Type': 'application/json' } : {}),
      },
      body: payload ? JSON.stringify({ schemaVersion: CLOUD_SNAPSHOT_SCHEMA_VERSION, payload }) : undefined,
    });
    const body = response.status === 204 ? null : await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok) {
      const code = typeof body?.code === 'string' ? body.code : 'cloud_request_failed';
      throw new CloudSyncError(code, 'Cloud sync is currently unavailable.', response.status);
    }
    return body;
  }

  async load() {
    const body = await this.request('GET');
    if (!body?.snapshot) return null;
    const snapshot = body.snapshot as CloudSnapshot;
    if (snapshot.schemaVersion !== CLOUD_SNAPSHOT_SCHEMA_VERSION || !isCloudStatePayload(snapshot.payload)) {
      throw new CloudSyncError('invalid_server_snapshot', 'The cloud snapshot format is not supported.', 502);
    }
    return snapshot;
  }

  async save(payload: CloudStatePayload) {
    const body = await this.request('PUT', payload);
    const snapshot = body?.snapshot as CloudSnapshot | undefined;
    if (!snapshot || snapshot.schemaVersion !== CLOUD_SNAPSHOT_SCHEMA_VERSION || !isCloudStatePayload(snapshot.payload)) {
      throw new CloudSyncError('invalid_server_snapshot', 'The cloud snapshot format is not supported.', 502);
    }
    return snapshot;
  }

  async remove() { await this.request('DELETE'); }
}

export function createCloudSnapshotClient(input: {
  accessToken: () => Promise<string | null>;
  endpoint?: string;
  fetchImpl?: typeof fetch;
}): CloudSnapshotClient {
  return new SupabaseSnapshotRepository(input);
}
