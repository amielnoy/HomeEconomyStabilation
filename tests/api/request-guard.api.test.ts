import { beforeEach, describe, expect, it } from 'vitest';
import { guardSnapshotRequest, resetRequestGuardForTests } from '../../api/request-guard';
import { HttpStatus } from '../../src/http-status';

describe('snapshot request guard', () => {
  beforeEach(resetRequestGuardForTests);

  it('requires JSON for writes and rejects declared oversized bodies', () => {
    expect(guardSnapshotRequest({ method: 'PUT', headers: { 'content-type': 'text/plain' } }))
      .toEqual({ status: HttpStatus.UNSUPPORTED_MEDIA_TYPE, code: 'json_content_type_required' });
    expect(guardSnapshotRequest({ method: 'PUT', headers: {
      'content-type': 'application/json', 'content-length': '1010001',
    } })).toEqual({ status: HttpStatus.CONTENT_TOO_LARGE, code: 'snapshot_too_large' });
  });

  it('bounds repeated requests per client without storing payloads or credentials', () => {
    const request = { method: 'GET', headers: { 'x-forwarded-for': '203.0.113.10' } };
    for (let index = 0; index < 60; index += 1) expect(guardSnapshotRequest(request, 1_000)).toBeNull();
    expect(guardSnapshotRequest(request, 1_000)).toMatchObject({ status: HttpStatus.TOO_MANY_REQUESTS, code: 'rate_limited' });
    expect(guardSnapshotRequest(request, 61_001)).toBeNull();
  });
});
