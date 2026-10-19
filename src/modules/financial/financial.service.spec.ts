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
      requireInvestorForCampaign: jest.fn(),
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

  it('supports verified USDC funding with server-validated agreement evidence', async () => {
    const c = createService();
    c.projectsService.requireInvestorForCampaign.mockResolvedValue({
      project: { currency: 'USDC' },
      agreementSnapshot: [{ title: 'Risk terms', acceptanceKey: 'terms:1' }],
    });
    const query = jest.fn().mockResolvedValue({
      rowCount: 0,
      rows: [{ id: 'intent-usdc', state: 'pending' }],
    });
    c.database.transaction.mockImplementation(
      (callback: (client: { query: jest.Mock }) => Promise<unknown>) =>
        callback({ query }),
    );
    await expect(
      c.service.createPaymentIntent({
        projectId: 'funding-project',
        contributorId: 'investor',
        currency: 'USDC',
        amountMinor: 1000000n,
        acceptedAgreements: ['terms:1'],
        idempotencyKey: 'usdc-intent',
        correlationId: 'correlation',
      }),
    ).resolves.toMatchObject({ id: 'intent-usdc' });
    expect(c.projectsService.requireInvestorForCampaign).toHaveBeenCalledWith(
      'funding-project',
      'investor',
      ['terms:1'],
    );
    expect(
      c.projectsService.ensureProjectCanReceiveDonation,
    ).not.toHaveBeenCalled();
    const queryCalls = query.mock.calls as unknown as [string, unknown[]][];
    expect(queryCalls[1][1]).toContain(
      JSON.stringify([{ title: 'Risk terms', acceptanceKey: 'terms:1' }]),
    );
  });

  it('fails before creating a USDC intent when KYC, wallet or agreement eligibility fails', async () => {
    const c = createService();
    c.projectsService.requireInvestorForCampaign.mockRejectedValue(
      new BadRequestException('Investment eligibility incomplete'),
    );
    await expect(
      c.service.createPaymentIntent({
        projectId: 'funding-project',
        contributorId: 'investor',
        currency: 'USDC',
        amountMinor: 1000000n,
        idempotencyKey: 'usdc-intent',
        correlationId: 'correlation',
      }),
    ).rejects.toThrow('eligibility incomplete');
    expect(c.database.transaction).not.toHaveBeenCalled();
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

  describe('on-chain settlement replay', () => {
    const wallet = '0x0000000000000000000000000000000000000002' as const;
    const transactionHash = `0x${'a'.repeat(64)}` as const;
    const request = {
      paymentIntentId: 'intent-1',
      contributorId: 'investor-1',
      projectOnchainId: '0',
      investorWallet: wallet,
      transactionHash,
      correlationId: 'correlation-1',
    };
    function setup(state = 'pending', matchingEvidence = true) {
      const context = createService();
      const payment = {
        id: 'intent-1',
        project_id: 'project-1',
        contributor_id: 'investor-1',
        amount_minor: '1000000',
        currency: 'USDC',
        state,
        capture_journal_id: state === 'settled' ? 'journal-1' : null,
      };
      context.database.query.mockResolvedValue({
        rowCount: 1,
        rows: [payment],
      });
      context.usersRepository.findById.mockResolvedValue({
        primaryWallet: wallet,
      });
      context.escrowWeb3.verifyDepositTx.mockResolvedValue(true);
      const query = jest.fn().mockImplementation((sql: string) => {
        if (sql.includes('FROM financial_payment_intents'))
          return Promise.resolve({ rowCount: 1, rows: [payment] });
        if (sql.includes('JOIN financial_journals'))
          return Promise.resolve({
            rowCount: matchingEvidence ? 1 : 0,
            rows: [{ id: 'journal-1' }],
          });
        if (sql.startsWith('SELECT id FROM financial_journals'))
          return Promise.resolve({ rowCount: 0, rows: [] });
        if (sql.includes('INSERT INTO financial_journals'))
          return Promise.resolve({ rowCount: 1, rows: [{ id: 'journal-1' }] });
        return Promise.resolve({ rowCount: 1, rows: [] });
      });
      context.database.transaction.mockImplementation(
        (callback: (client: { query: jest.Mock }) => Promise<unknown>) =>
          callback({ query }),
      );
      return { ...context, query };
    }

    it('settles a first valid contribution with one evidence row and one balanced journal', async () => {
      const { service, query } = setup();
      await expect(
        service.settleVerifiedOnchainContribution(request),
      ).resolves.toEqual({
        paymentIntentId: 'intent-1',
        ledgerJournalId: 'journal-1',
        transactionHash,
        replayed: false,
      });
      const sql = query.mock.calls.map(([statement]: [string]) => statement);
      expect(
        sql.filter((s) => s.includes('INSERT INTO financial_chain_evidence')),
      ).toHaveLength(1);
      expect(
        sql.filter((s) => s.includes('INSERT INTO financial_journals')),
      ).toHaveLength(1);
      expect(
        sql.filter((s) => s.includes('INSERT INTO financial_postings')),
      ).toHaveLength(2);
    });

    it('returns the existing result on repeated settlement without journal, receipt or investment writes', async () => {
      const { service, query } = setup('settled');
      for (let i = 0; i < 2; i++) {
        await expect(
          service.settleVerifiedOnchainContribution(request),
        ).resolves.toEqual({
          paymentIntentId: 'intent-1',
          ledgerJournalId: 'journal-1',
          transactionHash,
          replayed: true,
        });
      }
      expect(
        query.mock.calls.every(([sql]: [string]) =>
          sql.trim().startsWith('SELECT'),
        ),
      ).toBe(true);
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('JOIN financial_journals'),
        [
          11155111,
          '0x0000000000000000000000000000000000000001',
          transactionHash,
          'intent-1',
          `Contributed:${transactionHash}:0:${wallet}:1000000`,
          'journal-1',
          `chain-contribution:11155111:${transactionHash}`,
        ],
      );
    });

    it('rejects a different transaction or missing settlement evidence without financial writes', async () => {
      const { service, query } = setup('settled', false);
      await expect(
        service.settleVerifiedOnchainContribution({
          ...request,
          transactionHash: `0x${'b'.repeat(64)}`,
        }),
      ).rejects.toThrow('does not match this on-chain transaction');
      expect(
        query.mock.calls.every(([sql]: [string]) =>
          sql.trim().startsWith('SELECT'),
        ),
      ).toBe(true);
    });
  });
});
