import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { UserRole, KYCStatus } from '../../../common/enums/role.enum';
import { CreatorVerificationStatus } from '../../../common/enums/creator-verification-status.enum';

export type UserDocument = HydratedDocument<User>;

export class UserProfile {
  @Prop({ trim: true })
  displayName?: string;

  @Prop({ trim: true })
  firstName?: string;

  @Prop({ trim: true })
  lastName?: string;

  @Prop({ trim: true })
  avatarUrl?: string;

  @Prop({ trim: true })
  bio?: string;

  @Prop({ trim: true })
  country?: string;

  @Prop({ trim: true })
  locale?: string;
}

export class NotificationPreferences {
  @Prop({ default: true })
  projectUpdates!: boolean;

  @Prop({ default: true })
  approvals!: boolean;

  @Prop({ default: false })
  marketing!: boolean;
}

export class Accreditation {
  @Prop({ default: false })
  isAccredited!: boolean;

  @Prop({ trim: true })
  evidenceType?: string;

  @Prop({ type: Date })
  expiresAt?: Date;
}

export class KycData {
  @Prop({ type: String, enum: KYCStatus, default: KYCStatus.NOT_VERIFIED })
  status!: KYCStatus;

  @Prop({ type: Date })
  dateOfBirth?: Date;

  @Prop({ trim: true })
  provider?: string; // e.g., 'smile_id'

  @Prop({ trim: true })
  providerSessionId?: string; // Smile job_id

  @Prop({ trim: true })
  providerStatus?: string; // IN_PROGRESS | VERIFIED | REJECTED | FAILED

  @Prop({ trim: true })
  providerResultUrl?: string;

  @Prop({ trim: true })
  providerFailureReason?: string;

  @Prop({ type: Date })
  verifiedAt?: Date;

  @Prop({ trim: true })
  documentType?: string;

  @Prop({ trim: true })
  documentCountry?: string;

  @Prop({ trim: true })
  documentLast4?: string;

  @Prop({
    type: {
      line1: { type: String, trim: true },
      line2: { type: String, trim: true },
      city: { type: String, trim: true },
      state: { type: String, trim: true },
      postalCode: { type: String, trim: true },
      country: { type: String, trim: true },
    },
  })
  homeAddress?:
    | {
        line1?: string;
        line2?: string;
        city?: string;
        state?: string;
        postalCode?: string;
        country?: string;
      }
    | null;

  @Prop({
    type: [
      {
        title: { type: String, required: true, trim: true },
        url: { type: String, required: true, trim: true },
        type: { type: String, trim: true },
        isRequired: { type: Boolean, default: false },
      },
    ],
    default: [],
  })
  attachments!: Array<{
    title: string;
    url: string;
    type?: string;
    isRequired?: boolean;
  }>;

  @Prop({ type: Date })
  submittedAt?: Date;

  @Prop({ trim: true })
  failureReason?: string;

  @Prop({ type: Accreditation, default: {} })
  accreditation!: Accreditation;
}

export class CreatorVerification {
  @Prop({
    type: String,
    enum: CreatorVerificationStatus,
    default: CreatorVerificationStatus.NOT_SUBMITTED,
  })
  status!: CreatorVerificationStatus;

  @Prop({ type: [String], default: [] })
  evidenceUrls!: string[];

  @Prop({
    type: [
      {
        title: { type: String, required: true, trim: true },
        url: { type: String, required: true, trim: true },
        type: { type: String, trim: true },
        isRequired: { type: Boolean, default: false },
      },
    ],
    default: [],
  })
  attachments!: Array<{
    title: string;
    url: string;
    type?: string;
    isRequired?: boolean;
  }>;

  @Prop({ type: String, trim: true })
  failureReason?: string;

  @Prop({ type: Date })
  submittedAt?: Date;

  @Prop({ type: Date })
  verifiedAt?: Date;
}

export class MfaSettings {
  @Prop({ type: Boolean, default: false })
  enabled!: boolean;

  @Prop({ type: String, select: false, trim: true })
  secret?: string;

  @Prop({ type: String, select: false, trim: true })
  setupSecret?: string;

  @Prop({ type: Date })
  verifiedAt?: Date;
}

export class UserAvatar {
  @Prop({ type: Buffer })
  data!: Buffer;

  @Prop({ trim: true })
  mimeType?: string;

  @Prop({ trim: true })
  filename?: string;

  @Prop({ type: Date, default: Date.now })
  uploadedAt?: Date;
}

@Schema({
  collection: 'users',
  timestamps: true,
})
export class User {
  @Prop({
    required: false,
    unique: true,
    sparse: true,
    lowercase: true,
    trim: true,
  })
  email?: string;

  @Prop({ required: false, select: false })
  passwordHash?: string;

  @Prop({
    type: String,
    enum: ['email', 'google', 'apple'],
    default: 'email',
  })
  authProvider!: 'email' | 'google' | 'apple';

  @Prop({ trim: true })
  oauthProviderId?: string;

  @Prop({
    required: false,
    unique: true,
    sparse: true,
    lowercase: true,
    trim: true,
  })
  primaryWallet?: string;

  @Prop({ type: [String], default: [], lowercase: true })
  linkedWallets!: string[];

  @Prop({ type: [String], enum: UserRole, default: [UserRole.INVESTOR] })
  roles!: UserRole[];

  @Prop({ type: String, enum: KYCStatus, default: KYCStatus.NOT_VERIFIED })
  kycStatus!: KYCStatus;

  @Prop({ type: KycData, default: {} })
  kyc!: KycData;

  @Prop({ type: CreatorVerification, default: {} })
  creatorVerification!: CreatorVerification;

  @Prop({ type: MfaSettings, default: {} })
  mfa!: MfaSettings;

  @Prop({ type: UserAvatar })
  avatar?: UserAvatar;

  @Prop({ trim: true })
  residencyCountry?: string;

  @Prop({ trim: true })
  signupIp?: string;

  @Prop({ trim: true })
  lastLoginIp?: string;

  @Prop({ trim: true })
  phone?: string;

  @Prop({ type: Date })
  emailVerifiedAt?: Date;

  @Prop({ type: Date })
  emailVerificationSentAt?: Date;

  @Prop({ trim: true, select: false })
  emailVerificationCodeHash?: string;

  @Prop({ type: Date, select: false })
  emailVerificationCodeExpiresAt?: Date;

  @Prop({ type: Number, default: 0, select: false })
  emailVerificationAttempts?: number;

  @Prop({ type: Date, select: false })
  emailVerificationBlockedUntil?: Date;

  @Prop({ type: Number, default: 0 })
  emailVerificationSendCount?: number;

  @Prop({ type: Date })
  emailVerificationRateLimitResetAt?: Date;

  @Prop({ type: Date })
  passwordResetSentAt?: Date;

  @Prop({ type: Number, default: 0 })
  passwordResetSendCount?: number;

  @Prop({ type: Date })
  passwordResetRateLimitResetAt?: Date;

  @Prop({ type: Date })
  passwordUpdatedAt?: Date;

  @Prop({ type: Date })
  phoneVerifiedAt?: Date;

  @Prop({ type: NotificationPreferences, default: {} })
  notifications!: NotificationPreferences;

  @Prop({ type: Date })
  termsAcceptedAt?: Date;

  @Prop({ type: Date })
  privacyAcceptedAt?: Date;

  @Prop({ type: Date })
  ageConfirmedAt?: Date;

  @Prop({ default: false })
  isBlocked!: boolean;

  @Prop({ default: true })
  isActive!: boolean;

  @Prop({ type: Date })
  lastLoginAt?: Date;

  @Prop({ default: null, select: false })
  nonce?: string;

  @Prop({ type: UserProfile, default: {} })
  profile!: UserProfile;
}

export const UserSchema = SchemaFactory.createForClass(User);

UserSchema.index({ roles: 1, kycStatus: 1 });
