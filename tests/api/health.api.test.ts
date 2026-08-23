import { describe, expect, it, vi } from 'vitest';
import healthHandler from '../../api/health';
import { HttpStatus } from '../../src/http-status';

function responseDouble() {
  const response = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    status: vi.fn((code: number) => { response.statusCode = code; return response; }),
    setHeader: vi.fn((name: string, value: string) => { response.headers[name] = value; }),
    json: vi.fn((body: unknown) => { response.body = body; }),
    end: vi.fn(),
  };
  return response;
}

describe('public health API', () => {
  it('returns a cache-free service status for GET', () => {
    const response = responseDouble();
    healthHandler({ method: 'GET' }, response);

    expect(response.statusCode).toBe(HttpStatus.OK);
    expect(response.headers['Cache-Control']).toBe('no-store');
    expect(response.body).toEqual({ status: 'ok', service: 'home-economy-api' });
  });

  it('supports HEAD and rejects state-changing methods', () => {
    const headResponse = responseDouble();
    healthHandler({ method: 'HEAD' }, headResponse);
    expect(headResponse.statusCode).toBe(HttpStatus.OK);
    expect(headResponse.end).toHaveBeenCalledOnce();

    const postResponse = responseDouble();
    healthHandler({ method: 'POST' }, postResponse);
    expect(postResponse.statusCode).toBe(HttpStatus.METHOD_NOT_ALLOWED);
    expect(postResponse.body).toEqual({ code: 'method_not_allowed' });
  });
});
