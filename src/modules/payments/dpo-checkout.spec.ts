import { ConfigService } from '@nestjs/config';
import { PaymentsService } from './payments.service';
import {
  PaymentMethod,
  PaymentStatus,
} from './schemas/payment-transaction.schema';

const projectId = '507f1f77bcf86cd799439011';
const userId = '507f1f77bcf86cd799439012';
const intentId = '22222222-2222-4222-8222-222222222222';
const setup = () => {
  let stored: Record<string, unknown> | null = null;
  const transactions = {
    findOne: jest.fn(() => Promise.resolve(stored)),
    findOneAndUpdate: jest.fn(),
    updateOne: jest.fn().mockResolvedValue({ acknowledged: true }),
    create: jest.fn((value: Record<string, unknown>) => {
      stored = value;
      return Promise.resolve(value);
    }),
  };
  const dpo = {
    createToken: jest.fn().mockResolvedValue({ token: 'test-token' }),
  };
  const financial = { assertIntentForCheckout: jest.fn() };
  const charityProject = {
    projectType: 'CHARITY',
    name: 'Sandbox charity',
    currency: 'UGX',
  };
  const projects = {
    ensureProjectExists: jest.fn().mockResolvedValue(charityProject),
    ensureProjectCanReceiveDonation: jest.fn(),
  };
  const service = new PaymentsService(
    transactions as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    dpo as never,
    {} as never,
    new ConfigService({
      BACKEND_URL: 'https://api.keibo.test',
      FRONTEND_URL: 'https://keibo.test',
      DPO_PAYMENT_URL: 'https://sandbox.dpo.test/payv3.php',
    }),
    projects as never,
    {} as never,
    {} as never,
    financial as never,
    {} as never,
  );
  return { service, dpo, transactions, financial };
};
describe('Charity DPO checkout retry safety', () => {
  const input = {
    projectId,
    paymentIntentId: intentId,
    amount: 5000,
    currency: 'UGX',
    paymentMethod: PaymentMethod.Card,
  };
  it('reuses the same provider session on retry and honors the configured checkout host', async () => {
    const c = setup();
    const first = await c.service.initializeDPOPayment(input, userId);
    const replay = await c.service.initializeDPOPayment(input, userId);
    expect(first).toEqual(replay);
    expect(first.redirectUrl).toBe(
      'https://sandbox.dpo.test/payv3.php?ID=test-token',
    );
    expect(c.dpo.createToken).toHaveBeenCalledTimes(1);
    expect(c.transactions.create).toHaveBeenCalledTimes(1);
    expect(c.dpo.createToken).toHaveBeenCalledWith(
      projectId,
      expect.any(Number),
      'UGX',
      expect.any(String),
      expect.any(String),
      expect.any(String),
      `KEIBO-${intentId}`,
    );
    expect(c.financial.assertIntentForCheckout).toHaveBeenCalledTimes(2);
  });
  it('never contacts the provider when the intent does not belong to the authenticated donor', async () => {
    const c = setup();
    c.financial.assertIntentForCheckout.mockRejectedValue(
      new Error('Intent does not match donor'),
    );
    await expect(c.service.initializeDPOPayment(input, userId)).rejects.toThrow(
      'does not match',
    );
    expect(c.dpo.createToken).not.toHaveBeenCalled();
  });
});

describe('DPO delayed-settlement recovery', () => {
  const reconcile = (service: PaymentsService) =>
    (
      service as unknown as { reconcilePendingDpoPayments(): Promise<void> }
    ).reconcilePendingDpoPayments();

  it('keeps paid donations eligible after seven days while bounding abandoned pending checkouts', async () => {
    const c = setup();
    c.transactions.findOneAndUpdate.mockResolvedValue(null);
    await reconcile(c.service);
    expect(c.transactions.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: { $in: [PaymentStatus.Pending, PaymentStatus.Successful] },
        'metadata.dpoSettlementReconciled': { $ne: true },
        createdAt: { $lte: expect.any(Date) },
        $and: [
          {
            $or: [
              { status: PaymentStatus.Successful },
              { createdAt: { $gte: expect.any(Date) } },
            ],
          },
        ],
      }),
      expect.any(Object),
      expect.any(Object),
    );
  });

  it.each(['settled', 'released'])(
    'stops automatic retries only after ledger state %s',
    async (status) => {
      const c = setup();
      c.transactions.findOneAndUpdate
        .mockResolvedValueOnce({ _id: 'checkout', dpoToken: 'paid-token' })
        .mockResolvedValue(null);
      jest.spyOn(c.service, 'verifyDPOPayment').mockResolvedValue({
        status,
        paymentIntentId: intentId,
        verify: { status: '000', message: 'Paid' },
      });
      await reconcile(c.service);
      expect(c.transactions.updateOne).toHaveBeenCalledWith(
        { _id: 'checkout' },
        { $set: { 'metadata.dpoSettlementReconciled': true } },
        { timestamps: false },
      );
    },
  );

  it('keeps paid-but-unsettled donations retryable', async () => {
    const c = setup();
    c.transactions.findOneAndUpdate
      .mockResolvedValueOnce({ _id: 'checkout', dpoToken: 'paid-token' })
      .mockResolvedValue(null);
    jest.spyOn(c.service, 'verifyDPOPayment').mockResolvedValue({
      status: 'captured',
      paymentIntentId: intentId,
      verify: { status: '000', message: 'Paid' },
    });
    await reconcile(c.service);
    expect(c.transactions.updateOne).not.toHaveBeenCalled();
  });

  it('backs off expired checkouts without marking them settled', async () => {
    const c = setup();
    c.transactions.findOneAndUpdate
      .mockResolvedValueOnce({ _id: 'checkout', dpoToken: 'expired-token' })
      .mockResolvedValue(null);
    jest.spyOn(c.service, 'verifyDPOPayment').mockResolvedValue({
      status: 'pending',
      paymentIntentId: intentId,
      verify: { status: '901', message: 'Expired' },
    });
    await reconcile(c.service);
    expect(c.transactions.updateOne).toHaveBeenCalledWith(
      { _id: 'checkout' },
      { $set: { dpoVerifyAfter: expect.any(Date) } },
      { timestamps: false },
    );
  });
});
