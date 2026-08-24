import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HttpStatus } from '../../src/http-status';

const root = resolve(__dirname, '../..');
const spec = JSON.parse(readFileSync(resolve(root, 'openapi.json'), 'utf8'));
const docs = readFileSync(resolve(root, 'api-docs.html'), 'utf8');
const scalarDocs = readFileSync(resolve(root, 'scalar-docs.html'), 'utf8');

describe('Swagger/OpenAPI contract', () => {
  it('documents the public Vercel health operation without authentication', () => {
    const health = spec.paths['/api/health'].get;
    expect(health.operationId).toBe('getHealth');
    expect(health.security).toEqual([]);
    expect(health.responses).toHaveProperty(String(HttpStatus.OK));
  });

  it('documents every supported snapshot operation with bearer authentication', () => {
    const route = spec.paths['/api/snapshots'];
    expect(Object.keys(route).sort()).toEqual(['delete', 'get', 'put']);
    for (const method of ['get', 'put', 'delete']) {
      expect(route[method].security).toEqual([{ bearerAuth: [] }]);
      expect(route[method].operationId).toBeTruthy();
    }
  });

  it('documents only the privacy-minimised schema-v2 cloud payload', () => {
    const payload = spec.components.schemas.CloudStatePayload;
    expect(spec.components.schemas.SnapshotInput.properties.schemaVersion.const).toBe(2);
    expect(payload.required).not.toContain('accounts');
    expect(payload.properties).not.toHaveProperty('accounts');
    expect(spec.components.schemas.PrivacySafeTransaction.description).toContain('identifiers');
  });

  it('keeps the manual explorer self-hosted and pointed at the checked-in specification', () => {
    expect(docs).toContain('/openapi.json');
    expect(docs).toContain('/dist/swagger-ui/swagger-ui-bundle.js');
    expect(docs).not.toMatch(/https?:\/\//);
    expect(docs).toContain('/scalar-docs.html');

    expect(scalarDocs).toContain('/openapi.json');
    expect(scalarDocs).toContain('/dist/scalar/standalone.js');
    expect(scalarDocs).toContain("persistAuth: false");
    expect(scalarDocs).toContain('telemetry: false');
    expect(scalarDocs).toContain("showDeveloperTools: 'never'");
    expect(scalarDocs).toContain('agent: { disabled: true }');
    expect(scalarDocs).toContain('mcp: { disabled: true }');
    expect(scalarDocs).toContain('/api-docs.html');
    expect(scalarDocs).not.toMatch(/https?:\/\//);
  });

  it('documents the shared success and failure response codes', () => {
    const operations = spec.paths['/api/snapshots'];
    expect(operations.get.responses).toHaveProperty(String(HttpStatus.OK));
    expect(operations.put.responses).toHaveProperty(String(HttpStatus.BAD_REQUEST));
    expect(operations.delete.responses).toHaveProperty(String(HttpStatus.NO_CONTENT));
    for (const operation of Object.values(operations) as Array<{ responses: Record<string, unknown> }>) {
      expect(operation.responses).toHaveProperty(String(HttpStatus.UNAUTHORIZED));
      expect(operation.responses).toHaveProperty(String(HttpStatus.SERVICE_UNAVAILABLE));
    }
  });
});
