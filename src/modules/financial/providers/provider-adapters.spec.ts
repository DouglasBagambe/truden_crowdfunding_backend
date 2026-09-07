import { ConfigService } from '@nestjs/config';
import { DpoFinancialAdapter } from './dpo-financial.adapter';
import { FlutterwaveFinancialAdapter } from './flutterwave-financial.adapter';

function config(values: Record<string, string>): ConfigService {
  return {
    get: <T>(key: string): T | undefined => values[key] as T | undefined,
  } as ConfigService;
}

describe('financial provider adapters', () => {
  it('rejects missing, forged and placeholder Flutterwave evidence', () => {
    const disabled = new FlutterwaveFinancialAdapter(
      config({ FLUTTERWAVE_WEBHOOK_SECRET: 'replace-with-secret' }),
    );
    expect(() => disabled.verifyAndNormalize({}, 'anything')).toThrow(
      'disabled',
    );

    const adapter = new FlutterwaveFinancialAdapter(
      config({ FLUTTERWAVE_WEBHOOK_SECRET: 'local-test-secret' }),
    );
    expect(() => adapter.verifyAndNormalize({}, 'forged')).toThrow(
      'signature is invalid',
    );
  });

  it('normalizes only provider-verified DPO evidence', () => {
    const adapter = new DpoFinancialAdapter(
      config({
        DPO_COMPANY_TOKEN: 'local-test-token',
        DPO_API_URL: 'https://sandbox-provider.invalid/api',
      }),
    );
    const event = adapter.fromVerifiedToken({
      token: 'provider-token',
      paymentIntentId: 'intent-id',
      evidence: {
        status: '000',
        message: 'verified',
        amount: '10300',
        netAmount: '10000',
        currency: 'UGX',
      },
    });
    expect(event).toMatchObject({
      eventType: 'captured',
      amountMinor: 10_300n,
      providerFeeMinor: 300n,
    });
  });
});
