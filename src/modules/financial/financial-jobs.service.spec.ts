import type { PoolClient } from 'pg';
import { FinancialJobsService } from './financial-jobs.service';
import { PayoutProviderError } from './providers/payout-provider.error';

describe('FinancialJobsService', () => {
  it('persists a safe provider diagnosis and leaves a rejected payout dead-lettered', async () => {
    const client = {
      query: jest
        .fn()
        .mockResolvedValueOnce({
          rowCount: 1,
          rows: [
            {
              id: 'job',
              job_type: 'payout.dispatch.requested',
              aggregate_id: 'payout',
              payload: { payoutId: 'payout' },
              attempts: 0,
              max_attempts: 5,
            },
          ],
        })
        .mockResolvedValue({ rowCount: 1, rows: [] }),
    };
    const database = {
      transaction: (fn: (c: PoolClient) => Promise<unknown>) =>
        fn(client as unknown as PoolClient),
      query: jest.fn().mockResolvedValue({ rowCount: 1 }),
    };
    const payouts = {
      dispatch: jest.fn().mockRejectedValue(
        new PayoutProviderError(
          {
            response: {
              status: 400,
              data: { message: 'Insufficient balance for 256771234567' },
            },
          },
          'transfer submission',
        ),
      ),
    };
    const service = new FinancialJobsService(
      database as never,
      payouts as never,
    );
    await expect(service.processOne()).resolves.toEqual({
      processed: false,
      deadLettered: true,
    });
    const calls = database.query.mock.calls as unknown as [string, string[]][];
    const values = calls[0][1];
    expect(values).toContain('PROVIDER_PERMANENT');
    expect(values).toContain(
      'Flutterwave transfer submission failed (HTTP 400): Insufficient provider payout balance or fee coverage.',
    );
    expect(JSON.stringify(values)).not.toContain('256771234567');
    expect(database.query).toHaveBeenCalledTimes(1);
  });
  it('claims a due job once and dead-letters an unregistered handler', async () => {
    const client = { query: jest.fn() };
    client.query.mockResolvedValueOnce({
      rowCount: 1,
      rows: [
        {
          id: 'job',
          job_type: 'payout.dispatch.requested',
          aggregate_id: 'payout',
          payload: {},
          attempts: 0,
          max_attempts: 1,
        },
      ],
    });
    client.query.mockResolvedValueOnce({ rowCount: 1, rows: [] });
    const database = {
      transaction: jest.fn((fn: (connection: PoolClient) => Promise<unknown>) =>
        fn(client as unknown as PoolClient),
      ),
      query: jest.fn().mockResolvedValue({ rowCount: 1, rows: [] }),
    };
    const service = new FinancialJobsService(database as never);
    await expect(service.processOne()).resolves.toEqual({
      processed: false,
      deadLettered: true,
    });
    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining('status=$2'),
      expect.arrayContaining(['dead_letter']),
    );
  });
  it('recovers abandoned processing claims', async () => {
    const database = { query: jest.fn().mockResolvedValue({ rowCount: 2 }) };
    const service = new FinancialJobsService(database as never);
    await expect(service.recoverExpiredClaims()).resolves.toBe(2);
  });
});
