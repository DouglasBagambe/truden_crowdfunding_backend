import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

@Schema({ timestamps: true, collection: 'charity_donations' })
export class CharityDonation {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    required: true,
    index: true,
    ref: 'Project',
  })
  projectId!: Types.ObjectId;

  @Prop({ type: Number, required: true })
  amount!: number;

  @Prop({ type: String, trim: true, default: null })
  donorName?: string | null;

  @Prop({ type: String, trim: true, default: null })
  message?: string | null;
}

export type CharityDonationDocument = CharityDonation & Document;

export const CharityDonationSchema = SchemaFactory.createForClass(CharityDonation);
