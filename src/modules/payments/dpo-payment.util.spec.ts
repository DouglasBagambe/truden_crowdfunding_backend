import { PaymentStatus } from './schemas/payment-transaction.schema';
import {
  calculateDpoIncomingQuote,
  normalizeDpoResult,
} from './dpo-payment.util';

describe('dpo-payment.util', () => {
  it('grosses up a net project amount so the project still receives the requested amount', () => {
    const quote = calculateDpoIncomingQuote({
      requestedAmount: 2000,
      currency: 'UGX',
      config: {
        dpoFeeBps: 250,
        dpoVatBps: 1800,
        keiboFeeBps: 0,
      },
    });

    expect(quote.grossAmount).toBeGreaterThan(2000);
    expect(quote.projectNetAmount).toBeGreaterThanOrEqual(2000);
    expect(Math.abs(quote.keiboFee)).toBe(0);
  });

  it('keeps mobile-money pending provider statuses in pending state', () => {
    expect(normalizeDpoResult('001')).toEqual({
      paymentStatus: PaymentStatus.Pending,
      terminal: false,
      isProviderError: false,
    });
    expect(normalizeDpoResult('005')).toEqual({
      paymentStatus: PaymentStatus.Pending,
      terminal: false,
      isProviderError: false,
    });
  });

  it('marks provider integration errors as failed instead of pending', () => {
    expect(normalizeDpoResult('801')).toEqual({
      paymentStatus: PaymentStatus.Failed,
      terminal: true,
      isProviderError: true,
    });
    expect(normalizeDpoResult('804')).toEqual({
      paymentStatus: PaymentStatus.Failed,
      terminal: true,
      isProviderError: true,
    });
  });
});
