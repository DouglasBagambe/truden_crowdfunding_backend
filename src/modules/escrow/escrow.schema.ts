import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import type { ActorInfo } from './types';
import {
  EscrowCurrency,
  EscrowStatus,
  DepositStatus,
  MilestoneLockStatus,
} from './types';

export type EscrowDocument = Escrow & Document;
export type DepositDocument = Deposit & Document;
export type EscrowEventLogDocument = EscrowEventLog & Document;
export type MilestoneLockDocument = MilestoneLock & Document;

@Schema({ timestamps: true })
export class Escrow {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  projectId!: Types.ObjectId;

  @Prop({ required: true, unique: true })
  escrowId!: string;

  @Prop({ type: String, enum: EscrowCurrency, required: true })
  currency!: EscrowCurrency;

  @Prop({ type: Number, default: 0 })
  totalLocked!: number;

  @Prop({
    type: [
      {
        milestoneId: { type: String, required: true },
        amount: { type: Number, required: true },
        lockedAt: { type: Date },
        releasedAt: { type: Date },
        status: {
          type: String,
          enum: Object.values(MilestoneLockStatus),
          default: MilestoneLockStatus.LOCKED,
        },
      },
    ],
    default: [],
  })
  lockedByMilestone!: {
    milestoneId: string;
    amount: number;
    lockedAt?: Date;
    releasedAt?: Date;
    status: MilestoneLockStatus;
  }[];

  @Prop({
    type: [{ type: MongooseSchema.Types.ObjectId, ref: 'Deposit' }],
    default: [],
  })
  deposits!: Types.ObjectId[];

  @Prop({ type: String, enum: EscrowStatus, default: EscrowStatus.ACTIVE })
  status!: EscrowStatus;
}

@Schema({ timestamps: true })
export class Deposit {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Escrow', index: true })
  escrowId?: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  projectId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  investorId!: Types.ObjectId;

  @Prop({ type: Number, required: true })
  amount!: number;

  @Prop({ type: String, enum: EscrowCurrency, required: true })
  currency!: EscrowCurrency;

  @Prop({ type: String, required: true })
  source!: string;

  @Prop({ type: String, unique: true, sparse: true })
  txHash?: string;

  @Prop()
  providerTxId?: string;

  @Prop()
  nftId?: string;

  @Prop({ type: String, enum: DepositStatus, default: DepositStatus.PENDING })
  status!: DepositStatus;

  @Prop({ type: MongooseSchema.Types.Mixed })
  metadata?: Record<string, any>;
}

@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class EscrowEventLog {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Escrow', index: true })
  escrowId?: Types.ObjectId;

  @Prop({ required: true })
  type!: string;

  @Prop({ type: MongooseSchema.Types.Mixed })
  payload!: Record<string, any>;

  @Prop()
  txHash?: string;

  @Prop({ type: MongooseSchema.Types.Mixed })
  actor?: ActorInfo;
}

@Schema({ timestamps: true })
export class MilestoneLock {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  projectId!: Types.ObjectId;

  @Prop({ required: true })
  milestoneId!: string;

  @Prop({ type: Number, required: true })
  amount!: number;

  @Prop({ type: Date })
  lockedAt?: Date;

  @Prop({ type: Date })
  releasedAt?: Date;

  @Prop({
    type: String,
    enum: MilestoneLockStatus,
    default: MilestoneLockStatus.LOCKED,
  })
  status!: MilestoneLockStatus;

  @Prop({
    type: [
      {
        by: { type: MongooseSchema.Types.ObjectId, required: true },
        signature: { type: String },
        timestamp: { type: Date, default: Date.now },
      },
    ],
    default: [],
  })
  approvals!: { by: Types.ObjectId; signature?: string; timestamp: Date }[];
}

export const EscrowSchema = SchemaFactory.createForClass(Escrow);
export const DepositSchema = SchemaFactory.createForClass(Deposit);
export const EscrowEventLogSchema =
  SchemaFactory.createForClass(EscrowEventLog);
export const MilestoneLockSchema = SchemaFactory.createForClass(MilestoneLock);

EscrowSchema.index({ projectId: 1 });
DepositSchema.index({ txHash: 1 }, { unique: true, sparse: true });
DepositSchema.index({ investorId: 1, escrowId: 1 });
EscrowEventLogSchema.index({ txHash: 1 }, { sparse: true });
EscrowEventLogSchema.index({ escrowId: 1 });
