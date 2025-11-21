import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { UserRole, KYCStatus } from '../../../common/enums/role.enum';

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
  password?: string;

  @Prop({
    required: false,
    unique: true,
    sparse: true,
    lowercase: true,
    trim: true,
  })
  primaryWallet?: string;

  @Prop({ type: [String], default: [], lowercase: true })
  linkedWallets: string[];

  @Prop({ type: [String], enum: UserRole, default: [UserRole.INVESTOR] })
  roles: UserRole[];

  @Prop({ type: String, enum: KYCStatus, default: KYCStatus.NOT_VERIFIED })
  kycStatus: KYCStatus;

  @Prop({ default: false })
  isBlocked: boolean;

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ type: Date })
  lastLoginAt?: Date;

  @Prop({ default: null, select: false })
  nonce?: string;

  @Prop({ type: UserProfile, default: {} })
  profile: UserProfile;
}

export const UserSchema = SchemaFactory.createForClass(User);

UserSchema.index({ email: 1 }, { unique: true, sparse: true });
UserSchema.index({ primaryWallet: 1 }, { unique: true, sparse: true });
UserSchema.index({ roles: 1, kycStatus: 1 });
