import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import axios from 'axios';
import { Types } from 'mongoose';
import { DiditKycProviderService } from './didit-kyc.provider';
import type { KycProfileDocument } from '../schemas/kyc-profile.schema';

jest.mock('axios');
// Axios methods are replaced by standalone Jest mock functions.
/* eslint-disable @typescript-eslint/unbound-method */
const post = jest.mocked(axios.post);
const get = jest.mocked(axios.get);
const profile = {
  userId: new Types.ObjectId(),
  providerReference: 'session-123',
} as KycProfileDocument;
const configured = {
  DIDIT_API_KEY: 'isolated-test-key',
  DIDIT_WORKFLOW_ID: 'isolated-workflow',
  DIDIT_WEBHOOK_SECRET: 'isolated-webhook-secret',
  FRONTEND_URL: 'https://uat.example.invalid',
  KYC_PROVIDER_MODE: 'sandbox',
};
function provider(overrides: Record<string, string | undefined> = {}) {
  const values: Record<string, string | undefined> = {
    ...configured,
    ...overrides,
  };
  return new DiditKycProviderService({
    get: (key: string) => values[key],
  } as ConfigService);
}

describe('Didit hosted verification', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each([
    'DIDIT_API_KEY',
    'DIDIT_WORKFLOW_ID',
    'DIDIT_WEBHOOK_SECRET',
    'FRONTEND_URL',
  ])('fails closed before transmission if %s is absent', async (key) => {
    await expect(
      provider({ [key]: undefined }).submitApplication(profile),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(post).not.toHaveBeenCalled();
  });

  it('uses the verification API for sandbox credentials and a browser return callback', async () => {
    post.mockResolvedValue({
      data: { session_id: 'session-123', url: 'https://verify.didit.me/test' },
    });
    const result = await provider().submitApplication(profile);
    expect(post).toHaveBeenCalledWith(
      'https://verification.didit.me/v3/session/',
      {
        callback: 'https://uat.example.invalid/dashboard?tab=kyc',
        workflow_id: 'isolated-workflow',
        vendor_data: profile.userId.toString(),
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': 'isolated-test-key',
        },
        timeout: 15000,
      },
    );
    expect(result.status).toBe('PENDING');
    expect(result.rawResponse?.verificationUrl).toBe(
      'https://verify.didit.me/test',
    );
  });

  it('does not turn a malformed provider response into a pending success', async () => {
    post.mockResolvedValue({ data: { session_id: 'session-123' } });
    await expect(provider().submitApplication(profile)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('polls the decision endpoint and preserves in-review state', async () => {
    get.mockResolvedValue({
      data: { session_id: 'session-123', status: 'In Review' },
    });
    expect((await provider().refreshStatus(profile)).status).toBe(
      'UNDER_REVIEW',
    );
    expect(get.mock.calls[0][0]).toBe(
      'https://verification.didit.me/v3/session/session-123/decision/',
    );
  });
});
