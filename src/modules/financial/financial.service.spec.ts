import { BadRequestException } from '@nestjs/common';
import { FinancialService } from './financial.service';

describe('FinancialService contribution eligibility', () => {
  const createService = () => {
    const database = {
      transaction: jest.fn(),
      query: jest.fn(),
    };
    const projectsService = {
      ensureProjectCanReceiveDonation: jest.fn(),
      getCharityMilestoneReleaseEligibility: jest.fn(),
      assertProjectOnchainId: jest.fn(),
    };
    const escrowWeb3 = {
      getRuntimeConfig: jest.fn().mockReturnValue({
        chainId: 11155111,
        escrow: '0x0000000000000000000000000000000000000001',
      }),
      verifyDepositTx: jest.fn(),
    };
    const usersRepository = { findById: jest.fn() };
    return {
      service: new FinancialService(
        database as never,
        projectsService as never,
        escrowWeb3 as never,
        usersRepository as never,
      ),
      database,
      projectsService,
      escrowWeb3,
      usersRepository,
    };
  };

  it('denies a pending campaign before creating an intent', async () => {
    const { service, database, projectsService } = createService();
    projectsService.ensureProjectCanReceiveDonation.mockRejectedValue(
      new BadRequestException(
        'Project is not approved to receive contributions',
      ),
    );

    await expect(
      service.createPaymentIntent({
        projectId: 'pending-project',
        contributorId: 'user-1',
        amountMinor: 100n,
        currency: 'UGX',
        idempotencyKey: 'pending-intent',
        correlationId: 'correlation-1',
      }),
    ).rejects.toThrow('not approved to receive contributions');
    expect(database.transaction).not.toHaveBeenCalled();
  });

  it('creates an intent only after an eligible campaign is confirmed', async () => {
    const { service, database, projectsService } = createService();
    projectsService.ensureProjectCanReceiveDonation.mockResolvedValue({});
    database.transaction.mockImplementation(
      (
        callback: (client: { query: jest.Mock }) => Promise<unknown>,
      ): Promise<unknown> =>
        callback({
          query: jest.fn().mockResolvedValue({
            rowCount: 0,
            rows: [{ id: 'intent-1', state: 'pending' }],
          }),
        }),
    );

    await expect(
      service.createPaymentIntent({
        projectId: 'approved-project',
        contributorId: 'user-1',
        amountMinor: 100n,
        currency: 'UGX',
        idempotencyKey: 'approved-intent',
        correlationId: 'correlation-2',
      }),
    ).resolves.toMatchObject({ id: 'intent-1', state: 'pending' });
    expect(
      projectsService.ensureProjectCanReceiveDonation,
    ).toHaveBeenCalledWith('approved-project');
    expect(database.transaction).toHaveBeenCalledTimes(1);
  });

  it.each(['captured', 'settled'] as const)(
    'denies a status-changed campaign before %s ledger mutation',
    async (eventType) => {
      const { service, projectsService } = createService();
      projectsService.ensureProjectCanReceiveDonation.mockRejectedValue(
        new BadRequestException(
          'Project is not approved to receive contributions',
        ),
      );
      const client = {
        query: jest.fn().mockResolvedValue({
          rowCount: 1,
          rows: [
            {
              id: 'intent-1',
              project_id: 'pending-project',
              amount_minor: '100',
              currency: 'UGX',
              state: eventType === 'captured' ? 'authorized' : 'captured',
              provider: null,
              provider_fee_minor: null,
              capture_journal_id: null,
            },
          ],
        }),
      };

      await expect(
        (
          service as unknown as {
            applyProviderEvent: (
              client: unknown,
              event: unknown,
            ) => Promise<void>;
          }
        ).applyProviderEvent(client, {
          provider: 'flutterwave',
          providerEventId: `${eventType}-event`,
          eventType,
          paymentIntentId: 'intent-1',
          amountMinor: 100n,
          currency: 'UGX',
        }),
      ).rejects.toThrow('not approved to receive contributions');

      expect(
        projectsService.ensureProjectCanReceiveDonation,
      ).toHaveBeenCalledWith('pending-project');
      expect(client.query).toHaveBeenCalledTimes(1);
    },
  );

  it('replays an identical charity release without re-entering campaign state', async () => {
    const { service, database, projectsService } = createService();
    database.query.mockResolvedValue({
      rows: [
        {
          id: 'release-1',
          project_id: 'project-1',
          milestone_id: 'milestone-1',
          creator_id: 'creator-1',
          requested_by: 'creator-1',
          currency: 'UGX',
          gross_amount_minor: '10000',
          owner_proceeds_minor: '9500',
          success_fee_minor: '500',
          ledger_journal_id: 'journal-1',
          payout_status: 'not_started',
        },
      ],
    });

    await expect(
      service.releaseApprovedCharityMilestone({
        projectId: 'project-1',
        milestoneId: 'milestone-1',
        requesterId: 'creator-1',
        isAdmin: false,
        idempotencyKey: 'release-key-1',
        correlationId: 'correlation-1',
      }),
    ).resolves.toMatchObject({
      id: 'release-1',
      replayed: true,
      externalPayoutStatus: 'not_started',
    });
    expect(
      projectsService.getCharityMilestoneReleaseEligibility,
    ).not.toHaveBeenCalled();
    expect(database.transaction).not.toHaveBeenCalled();
  });

  it('rejects a mutated release payload for an existing idempotency key', async () => {
    const { service, database, projectsService } = createService();
    database.query.mockResolvedValue({
      rows: [
        {
          id: 'release-1',
          project_id: 'project-1',
          milestone_id: 'milestone-1',
          creator_id: 'creator-1',
          requested_by: 'creator-1',
          currency: 'UGX',
          gross_amount_minor: '10000',
          owner_proceeds_minor: '9500',
          success_fee_minor: '500',
          ledger_journal_id: 'journal-1',
          payout_status: 'not_started',
        },
      ],
    });

    await expect(
      service.releaseApprovedCharityMilestone({
        projectId: 'project-1',
        milestoneId: 'different-milestone',
        requesterId: 'creator-1',
        isAdmin: false,
        idempotencyKey: 'release-key-1',
        correlationId: 'correlation-1',
      }),
    ).rejects.toThrow('different campaign release');
    expect(
      projectsService.getCharityMilestoneReleaseEligibility,
    ).not.toHaveBeenCalled();
    expect(database.transaction).not.toHaveBeenCalled();
  });

  it('fails before a financial transaction when campaign authorization rejects release', async () => {
    const { service, database, projectsService } = createService();
    database.query.mockResolvedValue({ rows: [] });
    projectsService.getCharityMilestoneReleaseEligibility.mockRejectedValue(
      new BadRequestException('Milestone is not approved for release'),
    );

    await expect(
      service.releaseApprovedCharityMilestone({
        projectId: 'project-1',
        milestoneId: 'milestone-1',
        requesterId: 'attacker-1',
        isAdmin: false,
        idempotencyKey: 'release-key-1',
        correlationId: 'correlation-1',
      }),
    ).rejects.toThrow('Milestone is not approved for release');
    expect(database.transaction).not.toHaveBeenCalled();
  });

  it('rejects a replayed chain transaction before it can post a second journal', async () => {
    const { service, database, projectsService, escrowWeb3, usersRepository } =
      createService();
    const chainHash = `0x${'a'.repeat(64)}`;
    database.query.mockResolvedValue({
      rowCount: 1,
      rows: [
        {
          project_id: 'project-1',
          contributor_id: 'investor-1',
          amount_minor: '1000000',
          currency: 'USDC',
        },
      ],
    });
    projectsService.assertProjectOnchainId.mockResolvedValue(undefined);
    usersRepository.findById.mockResolvedValue({
      primaryWallet: '0x0000000000000000000000000000000000000002',
      linkedWallets: [],
    });
    escrowWeb3.verifyDepositTx.mockResolvedValue(true);
    database.transaction.mockImplementation(
      (callback: (client: { query: jest.Mock }) => Promise<unknown>) =>
        callback({
          query: jest
            .fn()
            .mockResolvedValueOnce({
              rowCount: 1,
              rows: [
                {
                  id: 'intent-1',
                  project_id: 'project-1',
                  contributor_id: 'investor-1',
                  amount_minor: '1000000',
                  currency: 'USDC',
                  state: 'pending',
                },
              ],
            })
            .mockRejectedValueOnce({ code: '23505' }),
        }),
    );

    await expect(
      service.settleVerifiedOnchainContribution({
        paymentIntentId: 'intent-1',
        contributorId: 'investor-1',
        projectOnchainId: '42',
        investorWallet: '0x0000000000000000000000000000000000000002',
        transactionHash: chainHash,
        correlationId: 'correlation-1',
      }),
    ).rejects.toThrow('already been reserved');
  });

  it('rejects a wallet that is not linked to the authenticated intent owner', async () => {
    const { service, database, usersRepository, escrowWeb3 } = createService();
    database.query.mockResolvedValue({
      rowCount: 1,
      rows: [
        {
          project_id: 'project-1',
          contributor_id: 'investor-1',
          amount_minor: '1000000',
          currency: 'USDC',
        },
      ],
    });
    usersRepository.findById.mockResolvedValue({
      primaryWallet: '0x0000000000000000000000000000000000000003',
      linkedWallets: [],
    });

    await expect(
      service.settleVerifiedOnchainContribution({
        paymentIntentId: 'intent-1',
        contributorId: 'investor-1',
        projectOnchainId: '42',
        investorWallet: '0x0000000000000000000000000000000000000002',
        transactionHash: `0x${'a'.repeat(64)}`,
        correlationId: 'correlation-1',
      }),
    ).rejects.toThrow('not linked');
    expect(escrowWeb3.verifyDepositTx).not.toHaveBeenCalled();
  });
});
