import { FinancialPayoutWorker } from './financial-payout.worker';

const payout = (state = 'pending') => ({
  id: 'payout-1',
  state,
  provider_transfer_id: 'transfer-1',
  amount_minor: '9500',
  currency: 'UGX',
  keibo_reference: 'KEIBO-PAYOUT-release-1',
  idempotency_key: 'stable-key',
  provider_recipient_id: 'recipient-1',
  destination_status: 'verified',
  destination_creator: 'creator-1',
  creator_id: 'creator-1',
  release_creator: 'creator-1',
  owner_proceeds_minor: '9500',
  release_currency: 'UGX',
});
const setup = (row = payout()) => {
  const client = {
    query: jest
      .fn()
      .mockResolvedValue({ rowCount: 1, rows: [{ id: 'payout-1' }] }),
  };
  const database = {
    query: jest.fn().mockResolvedValue({ rowCount: 1, rows: [row] }),
    transaction: jest.fn((fn) => fn(client)),
  };
  const provider = {
    createTransfer: jest
      .fn()
      .mockResolvedValue({ id: 'transfer-1', status: 'PENDING' }),
    getTransferStatus: jest.fn(),
    verifyWebhookSignature: jest.fn(),
  };
  return {
    worker: new FinancialPayoutWorker(database as never, provider as never),
    database,
    client,
    provider,
  };
};

describe('FinancialPayoutWorker', () => {
  it.each([undefined, {}, { payoutId: 1 }])(
    'rejects malformed durable job payload %#',
    async (input) => {
      const { worker } = setup();
      await expect(
        worker.dispatch(input as Record<string, unknown>),
      ).rejects.toMatchObject({ code: 'INVALID_PAYLOAD' });
    },
  );
  it('dispatches exactly one authoritative provider transfer and schedules reconciliation', async () => {
    const { worker, provider, client } = setup({
      ...payout(),
      provider_transfer_id: null,
    });
    await worker.dispatch({ payoutId: 'payout-1' });
    expect(provider.createTransfer).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: 'recipient-1',
        amountMinor: 9500n,
        currency: 'UGX',
        reference: 'KEIBO-PAYOUT-release-1',
        idempotencyKey: 'stable-key',
      }),
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('provider_transfer_id IS NULL'),
      expect.arrayContaining(['payout-1', 'transfer-1', 'PENDING', 'pending']),
    );
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("'payout.reconcile.requested'"),
      expect.any(Array),
    );
  });
  it.each(['paid', 'pending'] as const)(
    'does not create a duplicate provider transfer when %s is already provider-backed or terminal',
    async (state) => {
      const { worker, provider } = setup(payout(state));
      await worker.dispatch({ payoutId: 'payout-1' });
      expect(provider.createTransfer).not.toHaveBeenCalled();
    },
  );
  it.each([
    'destination_status',
    'destination_creator',
    'release_creator',
    'amount_minor',
    'currency',
  ] as const)(
    'fails closed when %s differs from authoritative release',
    async (field) => {
      const row = { ...payout(), provider_transfer_id: null } as Record<
        string,
        unknown
      >;
      row[field] =
        field === 'amount_minor'
          ? '1'
          : field === 'currency'
            ? 'USD'
            : 'attacker';
      const { worker, provider } = setup(row);
      await expect(
        worker.dispatch({ payoutId: 'payout-1' }),
      ).rejects.toMatchObject({ code: 'PAYOUT_VALIDATION_FAILED' });
      expect(provider.createTransfer).not.toHaveBeenCalled();
    },
  );
  it.each(['SUCCESSFUL', 'FAILED'] as const)(
    'uses one terminal event for repeated %s reconciliation',
    async (status) => {
      const { worker, provider, client } = setup();
      provider.getTransferStatus.mockResolvedValue({ status });
      await worker.reconcile({ payoutId: 'payout-1' });
      const updates = client.query.mock.calls.filter(([sql]: [string]) =>
        sql.includes('COALESCE'),
      );
      expect(updates).toHaveLength(1);
      expect(client.query).toHaveBeenCalledWith(
        expect.stringContaining('financial_outbox'),
        expect.arrayContaining([
          status === 'SUCCESSFUL' ? 'payout.paid' : 'payout.failed',
        ]),
      );
    },
  );
  it('allows an authoritative SUCCESSFUL result to correct a previous failed state', async () => {
    const { worker, provider, client } = setup(payout('failed'));
    provider.getTransferStatus.mockResolvedValue({ status: 'SUCCESSFUL' });
    await worker.reconcile({ payoutId: 'payout-1' });
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('state=$2'),
      expect.arrayContaining(['payout-1', 'paid', 'SUCCESSFUL']),
    );
  });
  it.each(['PENDING', 'PROCESSING'] as const)(
    'reschedules non-terminal reconciliation status %s',
    async (status) => {
      const { worker, provider, client } = setup();
      provider.getTransferStatus.mockResolvedValue({ status });
      await worker.reconcile({ payoutId: 'payout-1' });
      expect(client.query).toHaveBeenCalledWith(
        expect.stringContaining('financial_jobs'),
        expect.any(Array),
      );
    },
  );
  it('retries unknown provider state rather than inventing a terminal payout state', async () => {
    const { worker, provider } = setup();
    provider.getTransferStatus.mockResolvedValue({ status: 'UNKNOWN' });
    await expect(
      worker.reconcile({ payoutId: 'payout-1' }),
    ).rejects.toMatchObject({ code: 'RPC_PENDING' });
  });
  it('correlates callback data and never regresses PAID', async () => {
    const { worker, database, client } = setup(payout('paid'));
    database.transaction.mockImplementation(
      async (fn: (c: typeof client) => unknown) =>
        fn({
          ...client,
          query: jest
            .fn()
            .mockResolvedValue({ rowCount: 1, rows: [payout('paid')] }),
        }),
    );
    await expect(
      worker.callback({
        transferId: 'transfer-1',
        reference: 'KEIBO-PAYOUT-release-1',
        amount: '9500',
        currency: 'UGX',
        status: 'FAILED',
      }),
    ).resolves.toEqual({ accepted: true });
    await expect(
      worker.callback({
        transferId: 'other',
        reference: 'KEIBO-PAYOUT-release-1',
        amount: '9500',
        currency: 'UGX',
        status: 'SUCCESSFUL',
      }),
    ).rejects.toThrow('does not match');
  });
});
