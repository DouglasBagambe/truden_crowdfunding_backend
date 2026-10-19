import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { of, throwError } from 'rxjs';
import { FlutterwaveV4AuthService } from './flutterwave-v4-auth.service';

const create = (
  values: Record<string, string> = {
    FLUTTERWAVE_V4_CLIENT_ID: 'sandbox-client',
    FLUTTERWAVE_V4_CLIENT_SECRET: 'sandbox-secret',
  },
) => {
  const post = jest
    .fn()
    .mockReturnValue(
      of({ data: { access_token: 'sandbox-access', expires_in: 600 } }),
    );
  return {
    post,
    auth: new FlutterwaveV4AuthService(new ConfigService(values), {
      post,
    } as unknown as HttpService),
  };
};
describe('Flutterwave v4 OAuth', () => {
  afterEach(() => jest.restoreAllMocks());
  it('exchanges only v4 credentials and shares a cached token across concurrent requests', async () => {
    const { auth, post } = create();
    expect(
      await Promise.all([
        auth.accessToken(),
        auth.accessToken(),
        auth.accessToken(),
      ]),
    ).toEqual(['sandbox-access', 'sandbox-access', 'sandbox-access']);
    expect(post).toHaveBeenCalledTimes(1);
    const calls = post.mock.calls as unknown as [string, string][];
    expect(calls[0][0]).toBe(
      'https://idp.flutterwave.com/realms/flutterwave/protocol/openid-connect/token',
    );
    const form = new URLSearchParams(calls[0][1]);
    expect(form.get('grant_type')).toBe('client_credentials');
    expect(form.get('client_id')).toBe('sandbox-client');
    expect(form.get('client_secret')).toBe('sandbox-secret');
  });
  it('refreshes before expiry', async () => {
    const { auth, post } = create();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    await auth.accessToken();
    clock.mockReturnValue(1_550_000);
    await auth.accessToken();
    expect(post).toHaveBeenCalledTimes(2);
  });
  it('fails closed with v3-only credentials', async () => {
    const { auth, post } = create({ FLUTTERWAVE_SECRET_KEY: 'v3-secret' });
    await expect(auth.accessToken()).rejects.toThrow(
      'OAuth client credentials are not configured',
    );
    expect(post).not.toHaveBeenCalled();
  });
  it('never exposes secret-bearing provider errors and permits a later retry', async () => {
    const { auth, post } = create();
    post.mockReturnValueOnce(
      throwError(() => new Error('sandbox-secret confidential request')),
    );
    await expect(auth.accessToken()).rejects.toThrow(
      'payout authentication failed',
    );
    await expect(auth.accessToken()).resolves.toBe('sandbox-access');
  });
});
