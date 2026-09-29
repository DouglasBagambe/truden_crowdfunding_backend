import { TreasuryService } from './treasury.service';

describe('TreasuryService KEIBO isolation', () => {
  it('rejects legacy reads and writes before Mongo or the legacy treasury client is touched', async () => {
    const transactions = {
      create: jest.fn(),
      find: jest.fn(),
      countDocuments: jest.fn(),
      aggregate: jest.fn(),
    };
    const wallets = { findOneAndUpdate: jest.fn() };
    const legacyClient = {
      adminWithdraw: jest.fn(),
      distributeFunds: jest.fn(),
      getFeeCapturedLogs: jest.fn(),
    };
    const config = {
      get: <T>(key: string): T | undefined =>
        (key === 'KEIBO_RECEIPT_CONTRACT_ADDRESS'
          ? '0x0000000000000000000000000000000000000001'
          : undefined) as T | undefined,
    };
    const service = new TreasuryService(
      transactions as never,
      wallets as never,
      legacyClient as never,
      config as never,
    );
    const admin = {
      sub: '507f1f77bcf86cd799439011',
      roles: ['admin'],
    } as never;

    await expect(
      service.recordFee({ amount: '1' } as never, admin),
    ).rejects.toMatchObject({ status: 410 });
    await expect(
      service.recordDonation({ amount: '1' } as never, admin),
    ).rejects.toMatchObject({ status: 410 });
    await expect(
      service.withdraw({ amount: '1' } as never, admin),
    ).rejects.toMatchObject({ status: 410 });
    await expect(
      service.distributeFunds({ recipients: [] } as never, admin),
    ).rejects.toMatchObject({ status: 410 });
    await expect(service.getTransactions({} as never)).rejects.toMatchObject({
      status: 410,
    });
    await expect(service.getBalance()).rejects.toMatchObject({ status: 410 });
    await expect(service.getSummary()).rejects.toMatchObject({ status: 410 });
    await expect(service.syncTreasuryEvents()).rejects.toMatchObject({
      status: 410,
    });

    expect(transactions.create).not.toHaveBeenCalled();
    expect(transactions.find).not.toHaveBeenCalled();
    expect(transactions.aggregate).not.toHaveBeenCalled();
    expect(wallets.findOneAndUpdate).not.toHaveBeenCalled();
    expect(legacyClient.adminWithdraw).not.toHaveBeenCalled();
    expect(legacyClient.distributeFunds).not.toHaveBeenCalled();
    expect(legacyClient.getFeeCapturedLogs).not.toHaveBeenCalled();
  });
});
