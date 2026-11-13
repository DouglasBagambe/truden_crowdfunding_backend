import type { PoolClient } from 'pg';
import { FinancialPayoutService } from './financial-payout.service';

const verifiedUser = {
  emailVerifiedAt: new Date(),
  kycStatus: 'VERIFIED',
  creatorVerification: { status: 'VERIFIED' },
};
const setup = () => {
  const client = { query: jest.fn() };
  const database = {
    query: jest.fn(),
    transaction: jest.fn((fn: (connection: PoolClient) => Promise<unknown>) =>
      fn(client as unknown as PoolClient),
    ),
  };
  const users = { findById: jest.fn().mockResolvedValue(verifiedUser) };
  const flutterwave = {
    assertLivePayoutReady: jest.fn(),
    findTransferByReference: jest.fn(),
    getTransferStatus: jest.fn(),
    environment: jest.fn().mockReturnValue('live'),
    createRecipient: jest.fn().mockResolvedValue({
      id: 'recipient-1',
      metadata: { network: 'MTN', status: 'ACTIVE' },
    }),
  };
  return {
    service: new FinancialPayoutService(
      database as never,
      users as never,
      flutterwave as never,
    ),
    database,
    client,
    users,
    flutterwave,
  };
};

describe('FinancialPayoutService', () => {
  it('denies cross-user provider lookups before any provider request', async () => {
    const { service, database, flutterwave } = setup();
    database.query.mockResolvedValue({ rowCount: 0, rows: [] });
    await expect(service.providerEvidence('other', 'payout')).rejects.toThrow(
      'Payout not found',
    );
    expect(flutterwave.findTransferByReference).not.toHaveBeenCalled();
    expect(flutterwave.getTransferStatus).not.toHaveBeenCalled();
  });
  it.each(['FAILED', 'SUCCESSFUL', 'PENDING', null])(
    'reads provider outcome %s without releasing, retrying or changing balances',
    async (status) => {
      const { service, database, flutterwave } = setup();
      database.query.mockResolvedValue({
        rowCount: 1,
        rows: [
          {
            keibo_reference: 'KEIBO-WALLET-ref',
            provider_transfer_id: null,
            amount_minor: '475',
            currency: 'UGX',
          },
        ],
      });
      flutterwave.findTransferByReference.mockResolvedValue(
        status
          ? {
              id: '123',
              reference: 'KEIBO-WALLET-ref',
              amount: '475',
              currency: 'UGX',
              status,
            }
          : null,
      );
      const result = await service.providerEvidence('owner', 'payout');
      expect(result.outcome).toBe(status || 'NO_MATCHING_TRANSFER');
      expect(flutterwave.findTransferByReference).toHaveBeenCalledWith(
        'KEIBO-WALLET-ref',
      );
      expect(database.query).toHaveBeenCalledTimes(1);
      expect(database.transaction).not.toHaveBeenCalled();
      expect(result).not.toHaveProperty('id');
    },
  );
  it.each([{ reference: 'other' }, { amount: '476' }, { currency: 'USD' }])(
    'rejects mismatched provider evidence: %j',
    async (override) => {
      const { service, database, flutterwave } = setup();
      database.query.mockResolvedValue({
        rowCount: 1,
        rows: [
          {
            keibo_reference: 'KEIBO-WALLET-ref',
            provider_transfer_id: null,
            amount_minor: '475',
            currency: 'UGX',
          },
        ],
      });
      flutterwave.findTransferByReference.mockResolvedValue({
        id: '123',
        reference: 'KEIBO-WALLET-ref',
        amount: '475',
        currency: 'UGX',
        status: 'SUCCESSFUL',
        ...override,
      });
      await expect(service.providerEvidence('owner', 'payout')).rejects.toThrow(
        'does not match',
      );
      expect(database.transaction).not.toHaveBeenCalled();
    },
  );
  it.each(['475', '999'])(
    'rejects below-minimum wallet withdrawal %s before any reservation or job',
    async (amount) => {
      const { service, client } = setup();
      client.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rowCount: 0, rows: [] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ currency: 'UGX' }] })
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [{ id: 'release', owner_proceeds_minor: amount }],
        });
      await expect(
        service.withdrawWallet({
          creatorId: 'creator-1',
          destinationId: 'dest',
          idempotencyKey: 'key',
          expectedAmountMinor: amount,
        }),
      ).rejects.toThrow('at least UGX 1,000');
      expect(
        client.query.mock.calls.some(([sql]: [string]) =>
          /^\s*(INSERT|UPDATE|DELETE)\b/.test(sql),
        ),
      ).toBe(false);
    },
  );
  it('accepts the minimum wallet amount and queues it without calling the provider', async () => {
    const { service, client } = setup();
    client.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ currency: 'UGX' }] })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [{ id: 'release', owner_proceeds_minor: '1000' }],
      })
      .mockResolvedValue({ rowCount: 1, rows: [] });
    await expect(
      service.withdrawWallet({
        creatorId: 'creator-1',
        destinationId: 'dest',
        idempotencyKey: 'key',
        expectedAmountMinor: '1000',
      }),
    ).resolves.toMatchObject({ state: 'pending', amountMinor: '1000' });
  });
  it.each(['pending', 'processing', 'paid', 'failed'])(
    'reports job failure independently of ledger state %s',
    async (state) => {
      const { service, database } = setup();
      database.query.mockResolvedValue({
        rowCount: 1,
        rows: [
          {
            id: 'payout',
            state,
            job_status: 'dead_letter',
            job_type: 'payout.dispatch.requested',
            last_error_code: 'PROVIDER_PERMANENT',
            last_error_message_safe:
              'Flutterwave transfer submission failed (HTTP 400): Amount is below the provider minimum.',
          },
        ],
      });
      const result = await service.getPayout('creator-1', 'payout');
      expect(result.state).toBe(state);
      expect(result.processingStatus).toBe(
        ['paid', 'failed'].includes(state) ? state : 'review_required',
      );
      expect(result).not.toHaveProperty('last_error_message_safe');
      expect(result).not.toHaveProperty('job_status');
      if (state === 'pending')
        expect(result).toMatchObject({
          failureStage: 'provider_submission',
          errorMessage: expect.stringContaining('HTTP 400') as unknown,
        });
    },
  );
  it('does not invent the reason for an older stopped payout or expose an untrusted job error', async () => {
    const { service, database } = setup();
    database.query.mockResolvedValue({
      rowCount: 1,
      rows: [
        {
          id: 'payout',
          state: 'pending',
          job_status: 'dead_letter',
          last_error_code: 'oops',
          last_error_message_safe: 'Bearer private-value',
        },
      ],
    });
    const result = await service.listPayouts('creator-1');
    expect(result[0]).toMatchObject({
      processingStatus: 'review_required',
      errorCode: 'PAYOUT_PROCESSING_ERROR',
      errorMessage: expect.stringContaining(
        'without detailed provider diagnostics',
      ) as unknown,
    });
    expect(JSON.stringify(result)).not.toContain('private-value');
    expect(database.query).toHaveBeenCalledTimes(1);
  });
  it.each([
    undefined,
    { ...verifiedUser, emailVerifiedAt: undefined },
    { ...verifiedUser, kycStatus: 'PENDING' },
    { ...verifiedUser, creatorVerification: { status: 'PENDING' } },
  ])('rejects payout destination for an unverified creator', async (user) => {
    const { service, users, flutterwave } = setup();
    users.findById.mockResolvedValue(user);
    await expect(
      service.createDestination({
        creatorId: 'creator-1',
        type: 'bank',
        accountNumber: '1234567890',
        bankOrNetwork: '110072',
        idempotencyKey: 'key',
      }),
    ).rejects.toThrow(/verification|KYC/);
    expect(flutterwave.createRecipient).not.toHaveBeenCalled();
  });
  it.each([
    {
      type: 'bank' as const,
      accountNumber: 'not-account',
      bankOrNetwork: '110072',
    },
    {
      type: 'mobile_money' as const,
      accountNumber: '2567',
      bankOrNetwork: '!',
    },
  ])('rejects malformed payout destination input', async (input) => {
    const { service, flutterwave } = setup();
    await expect(
      service.createDestination({
        creatorId: 'creator-1',
        ...input,
        idempotencyKey: 'key',
      }),
    ).rejects.toThrow('Invalid payout destination');
    expect(flutterwave.createRecipient).not.toHaveBeenCalled();
  });
  it('stores only masked display and safe provider metadata after recipient creation', async () => {
    const { service, database, flutterwave } = setup();
    database.query.mockResolvedValue({ rows: [{ id: 'destination-1' }] });
    await expect(
      service.createDestination({
        creatorId: 'creator-1',
        type: 'mobile_money',
        accountNumber: '256771234567',
        bankOrNetwork: 'MTN',
        idempotencyKey: 'key',
      }),
    ).resolves.toMatchObject({
      id: 'destination-1',
      maskedDisplay: 'Mobile money •••4567',
    });
    expect(flutterwave.createRecipient).toHaveBeenCalledWith(
      expect.objectContaining({ accountNumber: '256771234567' }),
    );
    const calls = database.query.mock.calls as unknown[][];
    const values: unknown = calls[0][1];
    expect(JSON.stringify(values)).not.toContain('256771234567');
    expect(JSON.stringify(values)).not.toContain('secret');
  });
  it('creates payout request atomically from the release authority and never calls provider synchronously', async () => {
    const { service, client, flutterwave } = setup();
    client.query
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            creator_id: 'creator-1',
            owner_proceeds_minor: '9500',
            currency: 'UGX',
          },
        ],
      })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'destination-1' }] })
      .mockResolvedValue({ rowCount: 1, rows: [] });
    await expect(
      service.request({
        creatorId: 'creator-1',
        releaseId: 'release-1',
        destinationId: 'destination-1',
        idempotencyKey: 'stable-key',
      }),
    ).resolves.toMatchObject({
      state: 'pending',
      keiboReference: 'KEIBO-PAYOUT-release-1',
      replayed: false,
    });
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('financial_payout_transfers'),
      expect.arrayContaining([
        '9500',
        'UGX',
        'KEIBO-PAYOUT-release-1',
        'stable-key',
      ]),
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("'payout.dispatch.requested'"),
      expect.any(Array),
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("'payout.requested'"),
      expect.any(Array),
    );
    expect(flutterwave.createRecipient).not.toHaveBeenCalled();
  });
  it.each(['wrong-owner', 'missing'] as const)(
    'rejects release that is not owned and eligible',
    async (kind) => {
      const { service, client } = setup();
      client.query.mockResolvedValue(
        kind === 'missing'
          ? { rowCount: 0, rows: [] }
          : {
              rowCount: 1,
              rows: [
                {
                  creator_id: 'other',
                  owner_proceeds_minor: '9500',
                  currency: 'UGX',
                },
              ],
            },
      );
      await expect(
        service.request({
          creatorId: 'creator-1',
          releaseId: 'release-1',
          destinationId: 'destination-1',
          idempotencyKey: 'key',
        }),
      ).rejects.toThrow('Eligible release not found');
    },
  );
  it('replays a duplicate request without a second transfer, job, or outbox record', async () => {
    const { service, client } = setup();
    client.query
      .mockResolvedValueOnce({ rowCount: 1, rows: [] })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            creator_id: 'creator-1',
            owner_proceeds_minor: '9500',
            currency: 'UGX',
          },
        ],
      })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({
        rowCount: 1,
        rows: [
          {
            id: 'payout-1',
            state: 'pending',
            keibo_reference: 'KEIBO-PAYOUT-release-1',
          },
        ],
      });
    await expect(
      service.request({
        creatorId: 'creator-1',
        releaseId: 'release-1',
        destinationId: 'destination-1',
        idempotencyKey: 'key',
      }),
    ).resolves.toMatchObject({ id: 'payout-1', replayed: true });
    expect(client.query).toHaveBeenCalledTimes(4);
  });
  it('returns read models without raw destination or provider payload', async () => {
    const { service, database } = setup();
    database.query.mockResolvedValue({
      rowCount: 1,
      rows: [
        {
          id: 'payout-1',
          masked_display: 'Bank •••7890',
          state: 'pending',
          amount_minor: '9500',
          currency: 'UGX',
        },
      ],
    });
    const result = await service.getPayout('creator-1', 'payout-1');
    expect(result).toEqual(
      expect.not.objectContaining({
        account_number: expect.anything() as unknown,
        provider_metadata: expect.anything() as unknown,
        provider_recipient_id: expect.anything() as unknown,
      }),
    );
  });
});
