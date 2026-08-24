import { HttpStatus } from './http-status.js';
import { isPrivacySafeTransaction } from './privacy.js';
export const CLOUD_SNAPSHOT_SCHEMA_VERSION = 2;
export const CLOUD_SNAPSHOT_MAX_BYTES = 1_000_000;
export class CloudSyncError extends Error {
    code;
    status;
    constructor(code, message, status = 0) {
        super(message);
        this.code = code;
        this.status = status;
        this.name = 'CloudSyncError';
    }
}
const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
export function isCloudStatePayload(value) {
    if (!isRecord(value))
        return false;
    return Array.isArray(value.tx) && value.tx.length <= 50_000
        && isRecord(value.overrides)
        && Array.isArray(value.rules) && value.rules.length <= 1_000
        && Array.isArray(value.cats) && value.cats.length <= 1_000
        && isRecord(value.budgets)
        && !('accounts' in value)
        && value.tx.every(isPrivacySafeTransaction);
}
export function snapshotBytes(value) {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
export class SupabaseSnapshotRepository {
    input;
    endpoint;
    fetchImpl;
    constructor(input) {
        this.input = input;
        this.endpoint = input.endpoint || '/api/snapshots';
        this.fetchImpl = input.fetchImpl || fetch;
    }
    async request(method, payload) {
        const token = await this.input.accessToken();
        if (!token)
            throw new CloudSyncError('authentication_required', 'Sign in before using cloud sync.', HttpStatus.UNAUTHORIZED);
        if (payload && (!isCloudStatePayload(payload) || snapshotBytes(payload) > CLOUD_SNAPSHOT_MAX_BYTES)) {
            throw new CloudSyncError('invalid_snapshot', 'The snapshot is invalid or too large.', HttpStatus.BAD_REQUEST);
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
        const body = response.status === HttpStatus.NO_CONTENT ? null : await response.json().catch(() => null);
        if (!response.ok) {
            const code = typeof body?.code === 'string' ? body.code : 'cloud_request_failed';
            throw new CloudSyncError(code, 'Cloud sync is currently unavailable.', response.status);
        }
        return body;
    }
    async load() {
        const body = await this.request('GET');
        if (!body?.snapshot)
            return null;
        const snapshot = body.snapshot;
        if (snapshot.schemaVersion !== CLOUD_SNAPSHOT_SCHEMA_VERSION || !isCloudStatePayload(snapshot.payload)) {
            throw new CloudSyncError('invalid_server_snapshot', 'The cloud snapshot format is not supported.', HttpStatus.BAD_GATEWAY);
        }
        return snapshot;
    }
    async save(payload) {
        const body = await this.request('PUT', payload);
        const snapshot = body?.snapshot;
        if (!snapshot || snapshot.schemaVersion !== CLOUD_SNAPSHOT_SCHEMA_VERSION || !isCloudStatePayload(snapshot.payload)) {
            throw new CloudSyncError('invalid_server_snapshot', 'The cloud snapshot format is not supported.', HttpStatus.BAD_GATEWAY);
        }
        return snapshot;
    }
    async remove() { await this.request('DELETE'); }
}
export function createCloudSnapshotClient(input) {
    return new SupabaseSnapshotRepository(input);
}
