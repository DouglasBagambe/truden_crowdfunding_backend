import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { User } from '../../users/schemas/user.schema';
import {
  KycApplicationStatus,
  KycDocumentType,
} from '../interfaces/kyc.interface';

export type KycProfileDocument = HydratedDocument<KycProfile>;

@Schema({ _id: false })
export class KycDocument {
  @Prop({ type: String, enum: KycDocumentType, required: true })
  type!: KycDocumentType;

  @Prop({ trim: true })
  label?: string;

  @Prop({ required: true, trim: true })
  storageKey!: string;

  @Prop({ trim: true })
  url?: string;

  @Prop({ trim: true })
  mimeType?: string;

  @Prop()
  sizeBytes?: number;

  @Prop({ type: Date, default: Date.now })
  uploadedAt!: Date;

  @Prop({ type: Object })
  metadata?: Record<string, any>;
}

@Schema({ collection: 'kyc_profiles', timestamps: true })
export class KycProfile {
  @Prop({ type: Types.ObjectId, ref: User.name, required: true, unique: true })
  userId!: Types.ObjectId;

  @Prop({
    type: String,
    enum: KycApplicationStatus,
    default: KycApplicationStatus.UNVERIFIED,
  })
  status!: KycApplicationStatus;

  @Prop({ trim: true })
  level?: string;

  @Prop({ trim: true })
  firstName?: string;

  @Prop({ trim: true })
  lastName?: string;

  @Prop({ type: Date })
  dateOfBirth?: Date;

  @Prop({ trim: true })
  nationality?: string;

  @Prop({ trim: true })
  addressLine1?: string;

  @Prop({ trim: true })
  addressLine2?: string;

  @Prop({ trim: true })
  city?: string;

  @Prop({ trim: true })
  stateOrProvince?: string;

  @Prop({ trim: true })
  postalCode?: string;

  @Prop({ trim: true })
  country?: string;

  @Prop({ trim: true })
  idType?: string;

  @Prop({ trim: true })
  idNumberLast4?: string;

  @Prop({ trim: true })
  idCountry?: string;

  @Prop({ type: Date })
  idExpiryDate?: Date;

  @Prop({ trim: true })
  providerName?: string;

  @Prop({ trim: true })
  providerReference?: string;

  @Prop({ trim: true })
  providerStatus?: string;

  @Prop({ type: Object })
  providerRawResponse?: Record<string, any>;

  @Prop({ type: Date })
  submittedAt?: Date;

  @Prop({ type: Date })
  approvedAt?: Date;

  @Prop({ type: Date })
  rejectedAt?: Date;

  @Prop({ trim: true })
  rejectionReason?: string;

  @Prop({ trim: true })
  manualNotes?: string;

  @Prop({ type: [KycDocument], default: [] })
  documents!: KycDocument[];
}

export const KycProfileSchema = SchemaFactory.createForClass(KycProfile);

KycProfileSchema.index({ status: 1, submittedAt: -1 });
