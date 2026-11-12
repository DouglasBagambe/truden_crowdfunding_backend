import { PayoutProviderError } from './payout-provider.error';

describe('safe payout provider diagnostics', () => {
  it.each([
    [400, 'Insufficient balance', 'Insufficient provider payout balance'],
    [400, 'Minimum transfer amount is 1000', 'below the provider minimum'],
    [400, 'IP address not whitelisted', 'IP allowlist'],
    [401, 'Invalid key', 'authentication'],
    [403, 'Not permitted', 'permission'],
    [400, 'Duplicate reference', 'duplicate reference'],
    [429, 'Too many requests', 'rate limit'],
    [503, 'Unavailable', 'temporarily unavailable'],
  ])('captures HTTP %s with a recognized reason', (status, message, reason) => {
    const error = new PayoutProviderError(
      { response: { status, data: { message } } },
      'transfer submission',
    );
    expect(error.message).toContain(`HTTP ${status}`);
    expect(error.message).toContain(reason);
    expect(error.message).toContain('transfer submission');
    expect(error.code).toBe(
      status >= 500 || status === 429
        ? 'PROVIDER_RETRYABLE'
        : 'PROVIDER_PERMANENT',
    );
  });
  it('never includes raw response, headers, account, key or arbitrary message', () => {
    const error = new PayoutProviderError(
      {
        config: { headers: { Authorization: 'Bearer FLWSECK-sensitive' } },
        response: {
          status: 400,
          data: {
            message: 'Invalid request for Ada 256771234567 FLWSECK-sensitive',
            account_number: '256771234567',
          },
        },
      },
      'recipient creation',
    );
    const serialized = JSON.stringify(error.getResponse());
    expect(serialized).toContain('Unrecognized provider rejection');
    expect(serialized).not.toMatch(/256771234567|Ada|FLWSECK|Authorization/);
  });
  it('recognizes Axios timeouts without retaining raw error details', () => {
    expect(
      new PayoutProviderError({ code: 'ECONNABORTED' }, 'transfer submission'),
    ).toMatchObject({ code: 'PROVIDER_PERMANENT' });
  });
});
