import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Notification,
  NotificationCategory,
  NotificationDocument,
} from './schemas/notification.schema';

@Injectable()
export class NotificationsService {
  constructor(
    @InjectModel(Notification.name)
    private readonly notifications: Model<NotificationDocument>,
  ) {}

  async create(input: {
    recipientId: string;
    category: NotificationCategory;
    title: string;
    body: string;
    link?: string;
  }) {
    return this.notifications.create({
      ...input,
      recipientId: new Types.ObjectId(input.recipientId),
    });
  }

  async list(recipientId: string, category?: NotificationCategory) {
    const filter: {
      recipientId: Types.ObjectId;
      category?: NotificationCategory;
    } = { recipientId: new Types.ObjectId(recipientId) };
    if (category) filter.category = category;
    const items = await this.notifications
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    return items.map((item) => ({
      id: String(item._id),
      category: item.category,
      title: item.title,
      body: item.body,
      link: item.link,
      readAt: item.readAt ?? null,
      createdAt: item.createdAt,
    }));
  }

  async markRead(recipientId: string, id: string) {
    if (!Types.ObjectId.isValid(id))
      throw new NotFoundException('Notification not found');
    const result = await this.notifications
      .findOneAndUpdate(
        { _id: id, recipientId: new Types.ObjectId(recipientId) },
        { $set: { readAt: new Date() } },
        { new: true },
      )
      .lean();
    if (!result) throw new NotFoundException('Notification not found');
    return { id: String(result._id), readAt: result.readAt };
  }

  async markAllRead(recipientId: string) {
    const result = await this.notifications.updateMany(
      { recipientId: new Types.ObjectId(recipientId), readAt: null },
      { $set: { readAt: new Date() } },
    );
    return { updated: result.modifiedCount };
  }
}
