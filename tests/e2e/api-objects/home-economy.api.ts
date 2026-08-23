import type { APIRequestContext, APIResponse } from '@playwright/test';
import { step } from '../page-objects/step';

export class HomeEconomyApi {
  constructor(private readonly request: APIRequestContext) {}

  @step('Check that the public API is healthy')
  async getHealth(): Promise<APIResponse> {
    return this.request.get('/api/health');
  }

  @step('Check the health endpoint without downloading a response body')
  async headHealth(): Promise<APIResponse> {
    return this.request.head('/api/health');
  }

  @step('Check that the health endpoint rejects unsupported methods')
  async postHealth(): Promise<APIResponse> {
    return this.request.post('/api/health');
  }

  @step('Try to read a cloud snapshot without signing in')
  async getSnapshotWithoutAuthentication(): Promise<APIResponse> {
    return this.request.get('/api/snapshots');
  }

  @step('Check that the snapshot endpoint rejects unsupported methods')
  async postSnapshot(): Promise<APIResponse> {
    return this.request.post('/api/snapshots', { data: {} });
  }

  @step('Request an API route that does not exist')
  async getMissingRoute(): Promise<APIResponse> {
    return this.request.get('/api/not-a-real-route');
  }
}
