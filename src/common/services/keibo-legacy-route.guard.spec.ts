import { FinancialController } from '../../modules/financial/financial.controller';
import { InvestmentsController } from '../../modules/investments/controllers/investments.controller';
import { MarketplaceController } from '../../modules/marketplace/marketplace.controller';
import { NftController } from '../../modules/nfts/nft.controller';
import {
  PaymentsController,
  WalletController,
} from '../../modules/payments/payments.controller';
import { TreasuryController } from '../../modules/treasury/treasury.controller';
import {
  KEIBO_LEGACY_ROUTE_DISABLED,
  KeiboLegacyRouteGuard,
} from './keibo-legacy-route.guard';
import { KeiboContractConfigService } from './keibo-contract-config.service';

const blocked = async (call: () => unknown) => {
  await expect(Promise.resolve().then(call)).rejects.toMatchObject({
    status: 410,
    response: expect.objectContaining({
      code: KEIBO_LEGACY_ROUTE_DISABLED,
    }),
  });
};

const keiboModeGuard = () =>
  new KeiboLegacyRouteGuard({ isKeiboRuntimeEnabled: () => true } as never);

describe('KEIBO legacy route isolation', () => {
  it('recognizes a receipt address or enabled KEIBO contract configuration as KEIBO mode', () => {
    const receiptMode = new KeiboContractConfigService({
      get: (key: string) =>
        key === 'KEIBO_RECEIPT_CONTRACT_ADDRESS'
          ? '0x0000000000000000000000000000000000000001'
          : undefined,
    } as never);
    const completeMode = new KeiboContractConfigService({
      get: (key: string) =>
        ({
          BLOCKCHAIN_FEATURES_ENABLED: 'true',
          KEIBO_ESCROW_CONTRACT_ADDRESS:
            '0x0000000000000000000000000000000000000001',
        })[key],
    } as never);

    expect(receiptMode.isKeiboRuntimeEnabled()).toBe(true);
    expect(completeMode.isKeiboRuntimeEnabled()).toBe(true);
  });

  it('rejects every legacy investment route before its service is called', async () => {
    const service = {
      getInvestmentsByUser: jest.fn(),
      getMyInvestments: jest.fn(),
      getInvestmentsByProject: jest.fn(),
      repairDatabase: jest.fn(),
      retryAllFailedNftMints: jest.fn(),
      listInvestments: jest.fn(),
      updateStatus: jest.fn(),
      retryFailedNftMint: jest.fn(),
      getInvestmentById: jest.fn(),
    };
    const controller = new InvestmentsController(
      service as never,
      keiboModeGuard(),
    );
    const user = { sub: 'user', roles: [] } as never;

    for (const call of [
      () => controller.invest(user, {} as never),
      () => controller.getUserInvestments('user', user),
      () => controller.getMyInvestments(user),
      () => controller.getProjectInvestors('project', user),
      () => controller.repairProdDb(),
      () => controller.retryAllFailedNftMints(),
      () => controller.listInvestments({} as never, user),
      () => controller.updateStatus('investment', {} as never, user),
      () => controller.retryNftMint('investment'),
      () => controller.getInvestment('investment', user),
    ])
      await blocked(call);

    expect(
      Object.values(service).every((method) => !method.mock.calls.length),
    ).toBe(true);
  });

  it('rejects every legacy NFT route before Mongo or the legacy NFT client is called', async () => {
    const service = {
      mintNft: jest.fn(),
      findByWallet: jest.fn(),
      findByProject: jest.fn(),
      findOneByTokenId: jest.fn(),
      updateNFTValue: jest.fn(),
    };
    const controller = new NftController(service as never, keiboModeGuard());
    const user = { sub: 'admin', roles: ['admin'] } as never;

    for (const call of [
      () => controller.mint({} as never, user),
      () =>
        controller.getByWallet('0x0000000000000000000000000000000000000001'),
      () => controller.getByProject('project'),
      () => controller.getOne('1'),
      () => controller.updateValue('nft', {} as never, user),
    ])
      await blocked(call);

    expect(
      Object.values(service).every((method) => !method.mock.calls.length),
    ).toBe(true);
  });

  it('rejects every legacy treasury route before Mongo or a legacy chain write is called', async () => {
    const service = {
      recordFee: jest.fn(),
      recordDonation: jest.fn(),
      withdraw: jest.fn(),
      distributeFunds: jest.fn(),
      getTransactions: jest.fn(),
      getBalance: jest.fn(),
      getSummary: jest.fn(),
    };
    const controller = new TreasuryController(
      service as never,
      keiboModeGuard(),
    );
    const user = { sub: 'admin', roles: ['admin'] } as never;

    for (const call of [
      () => controller.recordFee({} as never, user),
      () => controller.recordDonation({} as never, user),
      () => controller.withdraw({} as never, user),
      () => controller.distribute({} as never, user),
      () => controller.getTransactions({} as never),
      () => controller.getBalance(),
      () => controller.getSummary(),
    ])
      await blocked(call);

    expect(
      Object.values(service).every((method) => !method.mock.calls.length),
    ).toBe(true);
  });

  it('rejects every marketplace route before legacy listing or purchase persistence is called', async () => {
    const service = {
      getActiveListings: jest.fn(),
      getMyListings: jest.fn(),
      getListingById: jest.fn(),
      recordListing: jest.fn(),
      cancelListing: jest.fn(),
      recordPurchase: jest.fn(),
    };
    const controller = new MarketplaceController(
      service as never,
      keiboModeGuard(),
    );
    const user = { sub: 'user', roles: [] } as never;

    for (const call of [
      () => controller.getListings(),
      () => controller.getMyListings(user),
      () => controller.getListing('listing'),
      () => controller.createListing({} as never, user),
      () => controller.cancelListing('listing', user),
      () => controller.recordPurchase('listing', {} as never, user),
    ])
      await blocked(call);

    expect(
      Object.values(service).every((method) => !method.mock.calls.length),
    ).toBe(true);
  });

  it('keeps only the ledger-backed charity release available under /wallet', async () => {
    const financial = {
      releaseApprovedCharityMilestone: jest
        .fn()
        .mockResolvedValue({ status: 'ACCOUNTED' }),
    };
    const controller = new WalletController(
      financial as never,
      keiboModeGuard(),
    );
    const request = { user: { sub: 'creator', roles: [] } } as never;

    await blocked(() => controller.getBalance());
    await blocked(() => controller.deposit());
    await blocked(() => controller.invest());
    await blocked(() => controller.approveRoiWithdrawal());
    await blocked(() => controller.getPendingWithdrawals());
    await blocked(() => controller.rejectRoiWithdrawal());
    await blocked(() => controller.addWithdrawalMethod());
    await blocked(() => controller.getTransactions());
    await blocked(() => controller.getWallet());

    await expect(
      controller.withdraw(
        { projectId: 'project', milestoneId: 'milestone' },
        'key',
        request,
      ),
    ).resolves.toEqual({ status: 'ACCOUNTED' });
    expect(financial.releaseApprovedCharityMilestone).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'project',
        milestoneId: 'milestone',
        requesterId: 'creator',
        idempotencyKey: 'key',
      }),
    );
  });

  it('rejects the legacy Mongo-backed payout callback before it can mutate payment state', async () => {
    const payments = { handlePayoutCallback: jest.fn() };
    const controller = new PaymentsController(
      payments as never,
      {} as never,
      keiboModeGuard(),
    );

    await blocked(() => controller.handlePayoutCallback({}, 'signature'));
    expect(payments.handlePayoutCallback).not.toHaveBeenCalled();
  });

  it('keeps verified on-chain contribution settlement independent from legacy-route isolation', () => {
    const financial = { settleVerifiedOnchainContribution: jest.fn() };
    const controller = new FinancialController(
      financial as never,
      {} as never,
      {} as never,
      {} as never,
    );

    controller.submitOnchainContribution(
      {
        paymentIntentId: 'intent',
        projectOnchainId: '1',
        investorWallet: '0x0000000000000000000000000000000000000001',
        transactionHash: `0x${'1'.repeat(64)}`,
      },
      { user: { sub: 'investor' } },
    );

    expect(financial.settleVerifiedOnchainContribution).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentIntentId: 'intent',
        contributorId: 'investor',
      }),
    );
  });
});
