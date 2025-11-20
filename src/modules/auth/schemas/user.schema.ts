import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';
import { UserRole, KYCStatus } from '../../../common/enums/role.enum';

export type UserDocument = User & Document;

@Schema({ timestamps: true })
export class User {
  @Prop({ required: false, unique: true, sparse: true })
  email?: string;

  @Prop({ required: false, select: false })
  password?: string;

  @Prop({ required: false, unique: true, sparse: true, lowercase: true })
  walletAddress?: string;

  @Prop({ type: [String], enum: UserRole, default: [UserRole.INVESTOR] })
  role: UserRole[];

  @Prop({ type: String, enum: KYCStatus, default: KYCStatus.NOT_VERIFIED })
  kycStatus: KYCStatus;

  @Prop({ required: false, select: false })
  nonce?: string;

  @Prop({ default: true })
  isActive: boolean;

  @Prop({ type: Date })
  lastLogin?: Date;

  @Prop({
    type: {
      firstName: { type: String, required: false },
      lastName: { type: String, required: false },
      avatar: { type: String, required: false },
      bio: { type: String, required: false },
    },
    default: {},
  })
  profile: {
    firstName?: string;
    lastName?: string;
    avatar?: string;
    bio?: string;
  };
}

export const UserSchema = SchemaFactory.createForClass(User);

UserSchema.index({ email: 1 });
UserSchema.index({ walletAddress: 1 });
UserSchema.index({ role: 1 });
UserSchema.index({ kycStatus: 1 });
