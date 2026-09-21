import { BadRequestException } from '@nestjs/common';
import { FinancialService } from './financial.service';

describe('FinancialService contribution eligibility', () => {
  const createService = () => {
    const database = {
      transaction: jest.fn(),
    };
    const projectsService = {
      ensureProjectCanReceiveDonation: jest.fn(),
    };
    return {
      service: new FinancialService(
        database as never,
        projectsService as never,
      ),
      database,
      projectsService,
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
});
