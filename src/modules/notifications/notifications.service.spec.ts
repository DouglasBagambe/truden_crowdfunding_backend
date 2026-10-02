import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  const recipientId = new Types.ObjectId().toString();
  const notificationId = new Types.ObjectId().toString();

  type QueryChain<T> = {
    sort: (value: Record<string, 1 | -1>) => QueryChain<T>;
    limit: (value: number) => QueryChain<T>;
    lean: () => Promise<T>;
  };

  const createQuery = <T>(value: T): QueryChain<T> => {
    const query: QueryChain<T> = {
      sort: jest.fn<QueryChain<T>, [Record<string, 1 | -1>]>(() => query),
      limit: jest.fn<QueryChain<T>, [number]>(() => query),
      lean: jest.fn<Promise<T>, []>().mockResolvedValue(value),
    };
    return query;
  };

  it('lists only the recipient notifications in newest-first order', async () => {
    const query = createQuery([
      {
        _id: new Types.ObjectId(notificationId),
        category: 'campaign',
        title: 'Campaign submitted',
        body: 'Your campaign is in review.',
        link: `/projects/${notificationId}`,
        readAt: null,
        createdAt: new Date('2026-10-01T00:00:00.000Z'),
      },
    ]);
    const model = {
      find: jest.fn<QueryChain<typeof query>, [Record<string, unknown>]>(
        () => query,
      ),
    };
    const service = new NotificationsService(model as never);

    await expect(service.list(recipientId, 'campaign')).resolves.toEqual([
      expect.objectContaining({
        id: notificationId,
        category: 'campaign',
        readAt: null,
      }),
    ]);
    const [findFilter] = model.find.mock.calls[0] ?? [];
    expect(findFilter?.category).toBe('campaign');
    expect(findFilter?.recipientId).toBeInstanceOf(Types.ObjectId);
    expect(query.sort).toHaveBeenCalledWith({ createdAt: -1 });
    expect(query.limit).toHaveBeenCalledWith(100);
  });

  it('does not allow one recipient to mark another recipient notification read', async () => {
    const model = {
      findOneAndUpdate: jest.fn<
        { lean: () => Promise<null> },
        [
          Record<string, unknown>,
          Record<string, unknown>,
          Record<string, unknown>,
        ]
      >(() => ({ lean: jest.fn<Promise<null>, []>().mockResolvedValue(null) })),
    };
    const service = new NotificationsService(model as never);

    await expect(
      service.markRead(recipientId, notificationId),
    ).rejects.toBeInstanceOf(NotFoundException);
    const [filter, update, options] =
      model.findOneAndUpdate.mock.calls[0] ?? [];
    expect(filter?._id).toBe(notificationId);
    expect(filter?.recipientId).toBeInstanceOf(Types.ObjectId);
    expect(update?.$set).toHaveProperty('readAt');
    expect(
      (update?.$set as { readAt?: unknown } | undefined)?.readAt,
    ).toBeInstanceOf(Date);
    expect(options).toEqual({ new: true });
  });

  it('rejects malformed notification IDs without querying the database', async () => {
    const model = { findOneAndUpdate: jest.fn() };
    const service = new NotificationsService(model as never);

    await expect(
      service.markRead(recipientId, 'not-an-object-id'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
  });
});
