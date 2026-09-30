import { createHmac } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { of, throwError } from 'rxjs';
import { FlutterwaveV4PayoutAdapter } from './flutterwave-v4-payout.adapter';

const config = (values: Record<string, string>) =>
  ({
    get: <T>(key: string): T | undefined => values[key] as T | undefined,
  }) as ConfigService;
const http = () => ({ post: jest.fn(), get: jest.fn() });

describe('FlutterwaveV4PayoutAdapter', () => {
  const values = {
    FLUTTERWAVE_SECRET_KEY: 'secret-not-to-log',
    FLUTTERWAVE_WEBHOOK_SECRET: 'webhook-secret',
    BACKEND_URL: 'https://api.keibo.test',
    FLUTTERWAVE_V4_BASE_URL: 'https://flutterwave.test/',
  };
  it.each([
    [
      'bank',
      {
        type: 'bank_account',
        account_number: '1234567890',
        bank_code: '110072',
        account_name: 'Creator',
        currency: 'UGX',
        country: 'UG',
      },
    ],
    [
      'mobile_money',
      {
        type: 'mobile_money',
        account_number: '256771234567',
        network: 'MTN',
        account_name: 'Creator',
        currency: 'UGX',
        country: 'UG',
      },
    ],
  ] as const)(
    'creates a Uganda %s recipient with safe authenticated request',
    async (type, expected) => {
      const client = http();
      client.post.mockReturnValue(
        of({ data: { data: { id: 'recipient-1', status: 'ACTIVE' } } }),
      );
      const adapter = new FlutterwaveV4PayoutAdapter(
        config(values),
        client as never,
      );
      await expect(
        adapter.createRecipient({
          type,
          accountNumber: expected.account_number,
          bankOrNetwork: type === 'bank' ? '110072' : 'MTN',
          accountName: 'Creator',
          idempotencyKey: 'key-1',
        }),
      ).resolves.toMatchObject({ id: 'recipient-1' });
      expect(client.post).toHaveBeenCalledWith(
        'https://flutterwave.test/transfers/recipients',
        expected,
        expect.objectContaining({
          headers: expect.objectContaining<Record<string, unknown>>({
            Authorization: 'Bearer secret-not-to-log',
            'X-Idempotency-Key': 'key-1',
            'X-Trace-Id': expect.any(String) as unknown,
          }) as unknown,
        }),
      );
    },
  );
  it.each([
    'NEW',
    'PENDING',
    'PROCESSING',
    'SUCCESSFUL',
    'FAILED',
    'mystery',
  ] as const)('normalizes transfer status %s', async (status) => {
    const client = http();
    client.post.mockReturnValue(
      of({ data: { data: { id: 'transfer-1', status } } }),
    );
    const adapter = new FlutterwaveV4PayoutAdapter(
      config(values),
      client as never,
    );
    await expect(
      adapter.createTransfer({
        recipientId: 'recipient-1',
        amountMinor: 9500n,
        currency: 'UGX',
        reference: 'KEIBO-PAYOUT-release',
        narration: 'Payout',
        idempotencyKey: 'stable-key',
      }),
    ).resolves.toMatchObject({
      id: 'transfer-1',
      status:
        status === 'NEW' || status === 'PENDING'
          ? 'PENDING'
          : status === 'mystery'
            ? 'UNKNOWN'
            : status,
    });
    expect(client.post).toHaveBeenCalledWith(
      'https://flutterwave.test/transfers',
      expect.objectContaining({
        reference: 'KEIBO-PAYOUT-release',
        callback_url:
          'https://api.keibo.test/api/financial/payouts/flutterwave/callback',
        payment_instruction: {
          recipient_id: 'recipient-1',
          amount: '9500',
          currency: 'UGX',
        },
      }),
      expect.objectContaining({
        headers: expect.objectContaining<Record<string, unknown>>({
          'X-Idempotency-Key': 'stable-key',
        }) as unknown,
      }),
    );
  });
  it.each([
    { response: { status: 429 } },
    { response: { status: 500 } },
    { code: 'ETIMEDOUT' },
  ])(
    'classifies transient provider failures for durable retry',
    async (error) => {
      const client = http();
      client.post.mockReturnValue(throwError(() => error));
      const adapter = new FlutterwaveV4PayoutAdapter(
        config(values),
        client as never,
      );
      await expect(
        adapter.createRecipient({
          type: 'bank',
          accountNumber: '1234567890',
          bankOrNetwork: '110072',
          idempotencyKey: 'key',
        }),
      ).rejects.toMatchObject({ code: 'PROVIDER_RETRYABLE' });
    },
  );
  it.each([{ response: { status: 400 } }, {}, { response: { status: 401 } }])(
    'classifies permanent provider failures without leaking request data',
    async (error) => {
      const client = http();
      client.post.mockReturnValue(throwError(() => error));
      const adapter = new FlutterwaveV4PayoutAdapter(
        config(values),
        client as never,
      );
      await expect(
        adapter.createRecipient({
          type: 'bank',
          accountNumber: '1234567890',
          bankOrNetwork: '110072',
          idempotencyKey: 'key',
        }),
      ).rejects.toMatchObject({ code: 'PROVIDER_PERMANENT' });
    },
  );
  it('rejects malformed responses and fetches transfer status with encoded id', async () => {
    const client = http();
    client.post.mockReturnValue(of({ data: { data: {} } }));
    client.get.mockReturnValue(
      of({
        data: {
          data: {
            id: 'id / 1',
            status: 'COMPLETED',
            amount: 9500,
            currency: 'UGX',
          },
        },
      }),
    );
    const adapter = new FlutterwaveV4PayoutAdapter(
      config(values),
      client as never,
    );
    await expect(
      adapter.createTransfer({
        recipientId: 'recipient',
        amountMinor: 1n,
        currency: 'UGX',
        reference: 'r',
        narration: 'n',
        idempotencyKey: 'k',
      }),
    ).rejects.toThrow('no transfer identifier');
    await expect(adapter.getTransferStatus('id / 1')).resolves.toMatchObject({
      id: 'id / 1',
      status: 'SUCCESSFUL',
      amount: '9500',
    });
    expect(client.get).toHaveBeenCalledWith(
      'https://flutterwave.test/transfers/id%20%2F%201',
      expect.objectContaining({
        headers: expect.objectContaining<Record<string, unknown>>({
          Authorization: 'Bearer secret-not-to-log',
          'X-Trace-Id': expect.any(String) as unknown,
        }) as unknown,
      }),
    );
  });
  it('verifies only the exact raw webhook body', () => {
    const client = http();
    const adapter = new FlutterwaveV4PayoutAdapter(
      config(values),
      client as never,
    );
    const raw = Buffer.from('{"a":1}');
    const signature = createHmac('sha256', values.FLUTTERWAVE_WEBHOOK_SECRET)
      .update(raw)
      .digest('base64');
    expect(adapter.verifyWebhookSignature(raw, signature)).toBe(true);
    expect(
      adapter.verifyWebhookSignature(Buffer.from('{"a": 1}'), signature),
    ).toBe(false);
    expect(adapter.verifyWebhookSignature(undefined, signature)).toBe(false);
    expect(adapter.verifyWebhookSignature(raw, undefined)).toBe(false);
  });
});
