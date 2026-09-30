import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  const recipientId = new Types.ObjectId().toString();
  const notificationId = new Types.ObjectId().toString();

  const createQuery = <T>(value: T) => {
    const query = {
      sort: jest.fn(() => query),
      limit: jest.fn(() => query),
      lean: jest.fn().mockResolvedValue(value),
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
    const model = { find: jest.fn(() => query) };
    const service = new NotificationsService(model as never);

    await expect(service.list(recipientId, 'campaign')).resolves.toEqual([
      expect.objectContaining({
        id: notificationId,
        category: 'campaign',
        readAt: null,
      }),
    ]);
    expect(model.find).toHaveBeenCalledWith({
      recipientId: expect.any(Types.ObjectId),
      category: 'campaign',
    });
    expect(query.sort).toHaveBeenCalledWith({ createdAt: -1 });
    expect(query.limit).toHaveBeenCalledWith(100);
  });

  it('does not allow one recipient to mark another recipient notification read', async () => {
    const model = {
      findOneAndUpdate: jest.fn(() => ({
        lean: jest.fn().mockResolvedValue(null),
      })),
    };
    const service = new NotificationsService(model as never);

    await expect(
      service.markRead(recipientId, notificationId),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: notificationId, recipientId: expect.any(Types.ObjectId) },
      { $set: { readAt: expect.any(Date) } },
      { new: true },
    );
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
