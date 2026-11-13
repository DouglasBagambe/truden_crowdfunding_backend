import { ConfigService } from '@nestjs/config';
import { DpoFinancialAdapter } from './dpo-financial.adapter';
import { FlutterwaveFinancialAdapter } from './flutterwave-financial.adapter';

function config(values: Record<string, string>): ConfigService {
  return {
    get: <T>(key: string): T | undefined => values[key] as T | undefined,
  } as ConfigService;
}

describe('financial provider adapters', () => {
  it.each([undefined, '', '0', '0.00'])(
    'records verified payment with unknown fees but never settles zero/missing net: %s',
    (netAmount) => {
      const adapter = new DpoFinancialAdapter(
        config({
          DPO_COMPANY_TOKEN: 'local-test-token',
          DPO_API_URL: 'https://sandbox-provider.invalid/api',
        }),
      );
      const evidence = {
        status: '000',
        message: 'Paid',
        amount: '2062',
        currency: 'UGX',
        netAmount,
        settlementDate: '2026/01/01',
      };
      const event = adapter.fromVerifiedToken({
        token: 'test',
        paymentIntentId: 'intent',
        evidence,
      });
      expect(event.amountMinor).toBe(2062n);
      expect(event).not.toHaveProperty('providerFeeMinor');
      expect(adapter.hasCompletedSettlement(evidence)).toBe(false);
      const refreshed = adapter.fromVerifiedToken({
        token: 'test',
        paymentIntentId: 'intent',
        evidence: { ...evidence, netAmount: '2000.14' },
      });
      expect(refreshed.providerFeeMinor).toBe(62n);
      expect(refreshed.providerEventId).not.toBe(event.providerEventId);
      expect(
        adapter.fromVerifiedToken({
          token: 'test',
          paymentIntentId: 'intent',
          evidence,
        }).providerEventId,
      ).toBe(event.providerEventId);
    },
  );
  it.each(['-1', 'oops', '2063'])(
    'rejects invalid net amount %s instead of fabricating a fee',
    (netAmount) => {
      const adapter = new DpoFinancialAdapter(
        config({
          DPO_COMPANY_TOKEN: 'local-test-token',
          DPO_API_URL: 'https://sandbox-provider.invalid/api',
        }),
      );
      expect(() =>
        adapter.fromVerifiedToken({
          token: 'test',
          paymentIntentId: 'intent',
          evidence: {
            status: '000',
            message: 'Paid',
            amount: '2062',
            currency: 'UGX',
            netAmount,
          },
        }),
      ).toThrow();
    },
  );
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
          settlementDate: '2026/01/01',
          currency: 'UGX',
        },
      }),
    ).toMatchObject({
      providerEventId: expect.stringMatching(
        /^verified-settlement:provider-token:v2:/,
      ) as unknown,
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

  it.each([undefined, '', '2099/01/01', '2026/02/31', '2026/13/01'])(
    'does not settle paid donations with an incomplete or invalid date: %s',
    (settlementDate) => {
      const adapter = new DpoFinancialAdapter(
        config({
          DPO_COMPANY_TOKEN: 'local-test-token',
          DPO_API_URL: 'https://sandbox-provider.invalid/api',
        }),
      );
      const evidence = {
        status: '000',
        message: 'paid',
        amount: '516',
        netAmount: '500.78',
        currency: 'UGX',
        settlementDate,
      };
      expect(
        adapter.fromVerifiedToken({
          token: 'token',
          paymentIntentId: 'intent',
          evidence,
        }),
      ).toMatchObject({ eventType: 'captured' });
      expect(adapter.hasCompletedSettlement(evidence)).toBe(false);
      expect(() =>
        adapter.fromVerifiedSettlement({
          token: 'token',
          paymentIntentId: 'intent',
          evidence,
        }),
      ).toThrow('settlement date has not completed');
    },
  );
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
