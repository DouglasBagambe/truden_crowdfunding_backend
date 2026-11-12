import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import type { Server } from 'http';
import { FinancialController } from './financial.controller';
import { FinancialService } from './financial.service';
import { FinancialOutboxService } from './financial-outbox.service';
import { FinancialPayoutService } from './financial-payout.service';
import { FinancialPayoutWorker } from './financial-payout.worker';
import { FinancialReceiptService } from './financial-receipt.service';
import { FlutterwaveFinancialAdapter } from './providers/flutterwave-financial.adapter';
import { FlutterwaveV4PayoutAdapter } from './providers/flutterwave-v4-payout.adapter';

describe('v3 payout webhook HTTP boundary', () => {
  let app: INestApplication;
  let httpServer: Server;
  const callback = jest.fn().mockResolvedValue({ accepted: true });
  const adapter = new FlutterwaveV4PayoutAdapter(
    {
      get: (key: string) =>
        ({
          FLUTTERWAVE_PAYOUT_API_VERSION: '3',
          FLUTTERWAVE_WEBHOOK_SECRET: 'local-webhook-hash',
        })[key],
    } as ConfigService,
    {} as never,
    {} as never,
  );
  const body = {
    event: 'transfer.completed',
    data: {
      id: 12345,
      reference: 'KEIBO-PAYOUT-1',
      amount: 475,
      currency: 'UGX',
      status: 'SUCCESSFUL',
    },
  };
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [FinancialController],
      providers: [
        ...[
          FinancialService,
          FlutterwaveFinancialAdapter,
          FinancialOutboxService,
          FinancialPayoutService,
          FinancialReceiptService,
          ConfigService,
        ].map((provide) => ({ provide, useValue: {} })),
        { provide: FlutterwaveV4PayoutAdapter, useValue: adapter },
        {
          provide: FinancialPayoutWorker,
          useValue: {
            verifyWebhookSignature: (
              raw: Buffer | undefined,
              signature: string | undefined,
              hash?: string,
            ) => adapter.verifyWebhookSignature(raw, signature, hash),
            supportsWebhookEvent: (body: Record<string, unknown>) =>
              adapter.supportsWebhookEvent(body),
            callback,
          },
        },
      ],
    }).compile();
    app = module.createNestApplication({ rawBody: true });
    await app.init();
    httpServer = app.getHttpServer() as Server;
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => callback.mockClear());
  it('accepts the v3 event and numeric fields, responding 200 for acknowledgement', async () => {
    await request(httpServer)
      .post('/financial/payouts/flutterwave/callback')
      .set('verif-hash', 'local-webhook-hash')
      .send(body)
      .expect(200);
    expect(callback).toHaveBeenCalledWith({
      transferId: '12345',
      reference: 'KEIBO-PAYOUT-1',
      amount: '475',
      currency: 'UGX',
      status: 'SUCCESSFUL',
    });
  });
  it.each([undefined, 'wrong'])(
    'rejects missing or wrong v3 hash: %s',
    async (hash) => {
      const call = request(httpServer).post(
        '/financial/payouts/flutterwave/callback',
      );
      if (hash) call.set('verif-hash', hash);
      await call.send(body).expect(403);
      expect(callback).not.toHaveBeenCalled();
    },
  );
  it('does not accept the v4 header as a v3 hash', async () => {
    await request(httpServer)
      .post('/financial/payouts/flutterwave/callback')
      .set('flutterwave-signature', 'local-webhook-hash')
      .send(body)
      .expect(403);
    expect(callback).not.toHaveBeenCalled();
  });
  it('rejects unrelated authenticated events without invoking payouts', async () => {
    await request(httpServer)
      .post('/financial/payouts/flutterwave/callback')
      .set('verif-hash', 'local-webhook-hash')
      .send({ ...body, event: 'charge.completed' })
      .expect(503);
    expect(callback).not.toHaveBeenCalled();
  });
});
