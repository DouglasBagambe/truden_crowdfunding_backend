import { CharityLedgerReadService } from './charity-ledger-read.service';

describe('CharityLedgerReadService donor privacy', () => {
  const projectId = '507f1f77bcf86cd799439011';
  const setup = (
    metadata: Record<string, unknown>[],
    contributor = 'owner',
  ) => {
    const database = {
      query: jest.fn().mockResolvedValue({
        rows: [
          {
            id: 'intent',
            contributor_id: contributor,
            project_id: projectId,
            amount_minor: '2062',
            currency: 'UGX',
            state: 'captured',
          },
        ],
      }),
    };
    const exec = jest.fn().mockResolvedValue(metadata);
    const lean = jest.fn().mockReturnValue({ exec });
    const select = jest.fn().mockReturnValue({ lean });
    const find = jest.fn().mockReturnValue({ select });
    return {
      database,
      find,
      select,
      service: new CharityLedgerReadService(
        database as never,
        { find } as never,
      ),
    };
  };
  it('displays the public name saved at the matching authenticated checkout', async () => {
    const { service, find, select } = setup([
      {
        userId: 'owner',
        metadata: { paymentIntentId: 'intent', donorName: 'Douglas Bagambe' },
      },
    ]);
    expect((await service.donors(projectId, 20))[0]).toMatchObject({
      donorName: 'Douglas Bagambe',
      amount: 2062,
    });
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'dpo',
        'metadata.paymentIntentId': { $in: ['intent'] },
      }),
    );
    expect(select).toHaveBeenCalledWith(
      'userId metadata.paymentIntentId metadata.donorName',
    );
  });
  it.each(
    [
      [],
      [
        {
          userId: 'owner',
          metadata: {
            paymentIntentId: 'intent',
            donorName: 'private@example.test',
          },
        },
      ],
      [
        {
          userId: 'other',
          metadata: { paymentIntentId: 'intent', donorName: 'Private Other' },
        },
      ],
      [
        {
          userId: 'owner',
          metadata: { paymentIntentId: 'other', donorName: 'Private Other' },
        },
      ],
      [
        {
          userId: 'owner',
          metadata: { paymentIntentId: 'intent', donorName: 'Anonymous' },
        },
      ],
      [
        {
          userId: 'owner',
          metadata: {
            paymentIntentId: 'intent',
            email: 'private@example.test',
          },
        },
      ],
      [
        {
          userId: 'owner',
          metadata: { paymentIntentId: 'intent', donorName: 'Name' },
        },
        {
          userId: 'owner',
          metadata: { paymentIntentId: 'intent', donorName: 'Anonymous' },
        },
      ],
    ].map((checkouts) => ({ checkouts })),
  )(
    'keeps absent, anonymous, mismatched, and ambiguous names private: %j',
    async ({ checkouts }) => {
      const { service } = setup(
        checkouts as unknown as Record<string, unknown>[],
      );
      expect((await service.donors(projectId, 20))[0].donorName).toBe(
        'Anonymous',
      );
    },
  );
});
