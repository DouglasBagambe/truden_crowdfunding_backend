import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export enum UserRole {
  User = 'user',
  Creator = 'creator',
  Admin = 'admin',
}

export enum KycStatus {
  None = 'none',
  Pending = 'pending',
  Approved = 'approved',
  Rejected = 'rejected',
}

export class UserProfile {
  @Prop({ required: true, trim: true })
  displayName: string;

  @Prop({ required: true, lowercase: true, trim: true })
  email: string;

  @Prop({ trim: true })
  avatarUrl?: string;

  @Prop({ trim: true })
  country?: string;
}

@Schema({
  collection: 'users',
  timestamps: true,
})
export class User {
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  primaryWallet: string;

  @Prop({ type: [String], default: [], lowercase: true })
  linkedWallets: string[];

  @Prop({ enum: UserRole, default: UserRole.User })
  role: UserRole;

  @Prop({ enum: KycStatus, default: KycStatus.None })
  kycStatus: KycStatus;

  @Prop({ type: UserProfile, required: true })
  profile: UserProfile;

  @Prop({ default: false })
  isBlocked: boolean;

  @Prop({ type: Date })
  lastLoginAt?: Date;
}

export type UserDocument = HydratedDocument<User>;

export const UserSchema = SchemaFactory.createForClass(User);

UserSchema.index({ role: 1, kycStatus: 1 });
UserSchema.index({ 'profile.email': 1 }, { unique: true });
