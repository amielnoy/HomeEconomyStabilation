import { HttpStatus } from '../src/http-status.js';

interface HealthRequest {
  method?: string;
}

interface HealthResponse {
  status(code: number): HealthResponse;
  setHeader(name: string, value: string): void;
  json(body: unknown): void;
  end(): void;
}

export default function handler(request: HealthRequest, response: HealthResponse) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Allow', 'GET, HEAD');
  if (!['GET', 'HEAD'].includes(request.method || '')) {
    return response.status(HttpStatus.METHOD_NOT_ALLOWED).json({ code: 'method_not_allowed' });
  }
  if (request.method === 'HEAD') return response.status(HttpStatus.OK).end();
  return response.status(HttpStatus.OK).json({ status: 'ok', service: 'home-economy-api' });
}
