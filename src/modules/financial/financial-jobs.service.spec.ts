import { FinancialJobsService } from './financial-jobs.service';

describe('FinancialJobsService', () => {
  it('claims a due job once and dead-letters an unregistered handler', async () => {
    const client = { query: jest.fn() };
    client.query.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'job', job_type: 'payout.dispatch.requested', aggregate_id: 'payout', payload: {}, attempts: 0, max_attempts: 1 }] });
    client.query.mockResolvedValueOnce({ rowCount: 1, rows: [] });
    const database = { transaction: jest.fn((fn) => fn(client)), query: jest.fn().mockResolvedValue({ rowCount: 1, rows: [] }) };
    const service = new FinancialJobsService(database as never);
    await expect(service.processOne()).resolves.toEqual({ processed: false, deadLettered: true });
    expect(database.query).toHaveBeenCalledWith(expect.stringContaining("status=$2"), expect.arrayContaining(['dead_letter']));
  });
  it('recovers abandoned processing claims', async () => {
    const database = { query: jest.fn().mockResolvedValue({ rowCount: 2 }) };
    const service = new FinancialJobsService(database as never);
    await expect(service.recoverExpiredClaims()).resolves.toBe(2);
  });
});
