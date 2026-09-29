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
    transaction: jest.fn((fn) => fn(client)),
  };
  const users = { findById: jest.fn().mockResolvedValue(verifiedUser) };
  const flutterwave = {
    createRecipient: jest
      .fn()
      .mockResolvedValue({
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
    const [, values] = database.query.mock.calls[0];
    expect(JSON.stringify(values)).not.toContain('256771234567');
    expect(JSON.stringify(values)).not.toContain('secret');
  });
  it('creates payout request atomically from the release authority and never calls provider synchronously', async () => {
    const { service, client, flutterwave } = setup();
    client.query
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
    expect(client.query).toHaveBeenCalledTimes(2);
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
        account_number: expect.anything(),
        provider_metadata: expect.anything(),
        provider_recipient_id: expect.anything(),
      }),
    );
  });
});
