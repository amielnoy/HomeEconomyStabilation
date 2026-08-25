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

  @step('Check that snapshot writes require JSON before authentication')
  async putSnapshotAsText(): Promise<APIResponse> {
    return this.request.put('/api/snapshots', {
      data: 'not-json', headers: { 'Content-Type': 'text/plain' },
    });
  }

  @step('Try to read cloud profile metadata without signing in')
  async getProfileWithoutAuthentication(): Promise<APIResponse> {
    return this.request.get('/api/profile');
  }

  @step('Try to read cloud consent metadata without signing in')
  async getCloudConsentWithoutAuthentication(): Promise<APIResponse> {
    return this.request.get('/api/consents/cloud-sync');
  }

  @step('Check that profile writes reject an unsupported locale')
  async putInvalidProfile(): Promise<APIResponse> {
    return this.request.put('/api/profile', { data: { preferredLocale: 'xx' } });
  }

  @step('Check that consent writes require JSON')
  async putConsentAsText(): Promise<APIResponse> {
    return this.request.put('/api/consents/cloud-sync', {
      data: 'not-json', headers: { 'Content-Type': 'text/plain' },
    });
  }

  @step('Check that consent rejects unsupported methods')
  async postCloudConsent(): Promise<APIResponse> {
    return this.request.post('/api/consents/cloud-sync', { data: {} });
  }

  @step('Request an API route that does not exist')
  async getMissingRoute(): Promise<APIResponse> {
    return this.request.get('/api/not-a-real-route');
  }
}
