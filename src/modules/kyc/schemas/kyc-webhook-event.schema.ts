import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type KycWebhookEventDocument = HydratedDocument<KycWebhookEvent>;

@Schema({ collection: 'kyc_webhook_events', timestamps: true })
export class KycWebhookEvent {
  @Prop({ required: true })
  provider!: string;

  @Prop({ required: true, unique: true })
  eventKey!: string;

  @Prop({ required: true })
  reference!: string;

  @Prop({ required: true })
  status!: string;

  @Prop({ type: Date, required: true, index: true })
  eventAt!: Date;
}

export const KycWebhookEventSchema =
  SchemaFactory.createForClass(KycWebhookEvent);
