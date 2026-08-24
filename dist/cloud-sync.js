import { HttpStatus } from './http-status.js';
import { isPrivacySafeSnapshot } from './privacy.js';
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
export function isCloudStatePayload(value) {
    return isPrivacySafeSnapshot(value);
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
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.input.timeoutMs ?? 10_000);
        let response;
        try {
            response = await this.fetchImpl(this.endpoint, {
                method,
                credentials: 'omit',
                signal: controller.signal,
                headers: {
                    Authorization: `Bearer ${token}`,
                    ...(payload ? { 'Content-Type': 'application/json' } : {}),
                },
                body: payload ? JSON.stringify({ schemaVersion: CLOUD_SNAPSHOT_SCHEMA_VERSION, payload }) : undefined,
            });
        }
        catch (cause) {
            if (controller.signal.aborted) {
                throw new CloudSyncError('cloud_timeout', 'Cloud sync timed out.', HttpStatus.GATEWAY_TIMEOUT);
            }
            throw new CloudSyncError('cloud_network_failed', 'Cloud sync is currently unavailable.');
        }
        finally {
            clearTimeout(timeout);
        }
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
