import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type NotificationDocument = HydratedDocument<Notification>;
export type NotificationCategory =
  | 'campaign'
  | 'financial'
  | 'system'
  | 'security';

@Schema({ collection: 'notifications', timestamps: true })
export class Notification {
  @Prop({ type: Types.ObjectId, required: true, index: true, immutable: true })
  recipientId!: Types.ObjectId;

  @Prop({
    required: true,
    enum: ['campaign', 'financial', 'system', 'security'],
  })
  category!: NotificationCategory;

  @Prop({ required: true, trim: true, maxlength: 160 })
  title!: string;

  @Prop({ required: true, trim: true, maxlength: 1000 })
  body!: string;

  @Prop({ trim: true, maxlength: 500 })
  link?: string;

  @Prop({ type: Date, default: null })
  readAt?: Date | null;

  createdAt?: Date;
  updatedAt?: Date;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);
NotificationSchema.index({ recipientId: 1, createdAt: -1 });
NotificationSchema.index({ recipientId: 1, readAt: 1, createdAt: -1 });
