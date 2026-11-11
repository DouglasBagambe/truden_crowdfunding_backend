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
        amount: '516.00',
        netAmount: '500.77',
        currency: 'UGX',
      },
    });
    expect(event).toMatchObject({
      eventType: 'captured',
      amountMinor: 516n,
      providerFeeMinor: 16n,
    });
    expect(
      adapter.fromVerifiedSettlement({
        token: 'provider-token',
        paymentIntentId: 'intent-id',
        evidence: {
          status: '000',
          message: 'verified',
          amount: '516.00',
          netAmount: '500.77',
          currency: 'UGX',
        },
      }),
    ).toMatchObject({
      providerEventId: 'verified-settlement:provider-token',
      eventType: 'settled',
      amountMinor: 516n,
      providerFeeMinor: 16n,
    });
  });

  it('refuses to make DPO funds available without a provider net amount', () => {
    const adapter = new DpoFinancialAdapter(
      config({
        DPO_COMPANY_TOKEN: 'local-test-token',
        DPO_API_URL: 'https://sandbox-provider.invalid/api',
      }),
    );
    expect(() =>
      adapter.fromVerifiedSettlement({
        token: 'provider-token',
        paymentIntentId: 'intent-id',
        evidence: {
          status: '000',
          message: 'verified',
          amount: '516.00',
          currency: 'UGX',
        },
      }),
    ).toThrow('no net settlement amount');
  });
});

describe('DPO missing configuration', () => {
  it('fails closed before accepting provider evidence', () => {
    const adapter = new DpoFinancialAdapter(config({}));
    expect(adapter.isConfigured()).toBe(false);
    expect(() =>
      adapter.fromVerifiedToken({
        token: 'fixture',
        paymentIntentId: 'fixture',
        evidence: { status: '000', amount: '100', currency: 'UGX' } as never,
      }),
    ).toThrow('disabled');
  });
});
