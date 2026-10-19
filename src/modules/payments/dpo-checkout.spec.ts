import { ConfigService } from '@nestjs/config';
import { PaymentsService } from './payments.service';
import { PaymentMethod } from './schemas/payment-transaction.schema';

const projectId = '507f1f77bcf86cd799439011';
const userId = '507f1f77bcf86cd799439012';
const intentId = '22222222-2222-4222-8222-222222222222';
const setup = () => {
  let stored: Record<string, unknown> | null = null;
  const transactions = {
    findOne: jest.fn(() => Promise.resolve(stored)),
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
