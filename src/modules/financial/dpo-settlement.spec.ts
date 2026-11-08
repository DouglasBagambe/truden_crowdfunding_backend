import type { PoolClient } from 'pg';
import { FinancialService } from './financial.service';

const input = {
  paymentIntentId: 'intent-1',
  currency: 'UGX',
  netAmountMinor: '500',
  evidenceReference: 'bank-settlement-1',
  settledAt: '2026-01-02T00:00:00Z',
  recordedBy: 'admin-1',
};
function setup(
  overrides: Record<string, unknown> = {},
  prior?: Record<string, unknown>,
) {
  const payment = {
    id: 'intent-1',
    project_id: 'campaign-1',
    provider: 'dpo',
    state: 'captured',
    amount_minor: '516',
    provider_fee_minor: '16',
    currency: 'UGX',
    created_at: new Date('2026-01-01'),
    ...overrides,
  };
  const query = jest.fn().mockImplementation((sql: string) => {
    if (sql.includes('FROM financial_payment_intents'))
      return Promise.resolve({ rowCount: 1, rows: [payment] });
    if (sql.includes('FROM financial_provider_settlements'))
      return Promise.resolve({
        rowCount: prior ? 1 : 0,
        rows: prior ? [prior] : [],
      });
    if (sql.startsWith('SELECT id FROM financial_journals'))
      return Promise.resolve({ rowCount: 0, rows: [] });
    if (sql.includes('INSERT INTO financial_journals'))
      return Promise.resolve({ rowCount: 1, rows: [{ id: 'journal-1' }] });
    if (sql.includes('SUM(credit_minor'))
      return Promise.resolve({ rowCount: 1, rows: [{ available: '500' }] });
    return Promise.resolve({ rowCount: 1, rows: [] });
  });
  const database = {
    transaction: (callback: (client: PoolClient) => Promise<unknown>) =>
      callback({ query } as unknown as PoolClient),
  };
  const service = new FinancialService(
    database as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, query, payment };
}
describe('DPO completed settlement reconciliation', () => {
  it('audits the administrator and settles only the net bank amount with a balanced journal', async () => {
    const { service, query } = setup();
    await expect(service.recordDpoSettlement(input)).resolves.toMatchObject({
      state: 'settled',
      replayed: false,
    });
    const calls = query.mock.calls as [string, unknown[]][];
    const postings = calls
      .filter(([sql]) => sql.includes('INSERT INTO financial_postings'))
      .map(([, values]) => values);
    expect(postings).toEqual([
      ['journal-1', 'UGX', 'asset:bank:UGX', '500', '0'],
      ['journal-1', 'UGX', 'liability:provider_cost:dpo:UGX', '16', '0'],
      ['journal-1', 'UGX', 'asset:provider_receivable:dpo:UGX', '0', '516'],
    ]);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO financial_provider_settlements'),
      [
        'intent-1',
        'UGX',
        '500',
        'bank-settlement-1',
        new Date(input.settledAt),
        'admin-1',
      ],
    );
  });
  it.each([
    { state: 'pending' },
    { state: 'refunded' },
    { provider: 'flutterwave' },
    { currency: 'USD' },
    { provider_fee_minor: '15' },
  ])(
    'rejects evidence incompatible with the captured payment %j',
    async (overrides) => {
      const { service, query } = setup(overrides);
      await expect(service.recordDpoSettlement(input)).rejects.toThrow();
      expect(
        query.mock.calls.some(([sql]: [string]) => sql.includes('INSERT INTO')),
      ).toBe(false);
    },
  );
  it('replays matching evidence without posting again', async () => {
    const { service, query } = setup(
      { state: 'settled' },
      {
        evidence_reference: input.evidenceReference,
        settled_at: new Date(input.settledAt),
      },
    );
    await expect(service.recordDpoSettlement(input)).resolves.toMatchObject({
      replayed: true,
    });
    expect(
      query.mock.calls.some(([sql]: [string]) => sql.includes('INSERT INTO')),
    ).toBe(false);
  });
  it('rejects conflicting settlement evidence on a retry', async () => {
    const { service } = setup(
      { state: 'settled' },
      {
        evidence_reference: 'different-record',
        settled_at: new Date(input.settledAt),
      },
    );
    await expect(service.recordDpoSettlement(input)).rejects.toThrow(
      'different settlement evidence',
    );
  });
  it('rejects a future settlement date before database writes', async () => {
    const { service, query } = setup();
    await expect(
      service.recordDpoSettlement({
        ...input,
        settledAt: '2999-01-01T00:00:00Z',
      }),
    ).rejects.toThrow();
    expect(query).not.toHaveBeenCalled();
  });
});
