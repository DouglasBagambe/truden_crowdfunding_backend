import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Deposit,
  DepositDocument,
  Escrow,
  EscrowDocument,
  EscrowEventLog,
  EscrowEventLogDocument,
  MilestoneLock,
  MilestoneLockDocument,
} from './schemas/escrow.schema';
import { DepositStatus, EscrowCurrency } from './types';

@Injectable()
export class EscrowRepository {
  constructor(
    @InjectModel(Escrow.name)
    private readonly escrowModel: Model<EscrowDocument>,
    @InjectModel(Deposit.name)
    private readonly depositModel: Model<DepositDocument>,
    @InjectModel(EscrowEventLog.name)
    private readonly eventLogModel: Model<EscrowEventLogDocument>,
    @InjectModel(MilestoneLock.name)
    private readonly milestoneLockModel: Model<MilestoneLockDocument>,
  ) {}

  async findOrCreateEscrow(
    projectId: Types.ObjectId,
    currency: EscrowCurrency,
  ): Promise<EscrowDocument> {
    const existing = await this.escrowModel
      .findOne({ projectId, currency })
      .exec();
    if (existing) return existing;

    const escrow = new this.escrowModel({
      projectId,
      escrowId: `${projectId.toHexString()}-${currency}`,
      currency,
      totalLocked: 0,
    });
    return escrow.save();
  }

  async createDeposit(data: Partial<Deposit>): Promise<DepositDocument> {
    const deposit = new this.depositModel(data);
    return deposit.save();
  }

  async attachDepositToEscrow(
    escrowId: Types.ObjectId,
    depositId: Types.ObjectId,
  ): Promise<void> {
    await this.escrowModel
      .updateOne({ _id: escrowId }, { $addToSet: { deposits: depositId } })
      .exec();
  }

  async markDepositStatus(
    depositId: Types.ObjectId,
    status: DepositStatus,
    extra: Partial<Deposit> = {},
  ): Promise<DepositDocument | null> {
    return this.depositModel
      .findByIdAndUpdate(
        depositId,
        {
          $set: {
            status,
            ...extra,
          },
        },
        { new: true },
      )
      .exec();
  }

  async incrementEscrowLocked(
    escrowId: Types.ObjectId,
    amount: number,
  ): Promise<void> {
    await this.escrowModel
      .updateOne({ _id: escrowId }, { $inc: { totalLocked: amount } })
      .exec();
  }

  async createEventLog(params: {
    escrowId?: Types.ObjectId;
    type: string;
    payload: Record<string, any>;
    txHash?: string;
    actor?: { id: string; role: string };
  }): Promise<EscrowEventLogDocument> {
    const event = new this.eventLogModel(params);
    return event.save();
  }

  async getEscrowByProject(
    projectId: Types.ObjectId,
  ): Promise<EscrowDocument | null> {
    return this.escrowModel.findOne({ projectId }).populate('deposits').exec();
  }

  async getEventsByTxHash(txHash: string): Promise<EscrowEventLogDocument[]> {
    return this.eventLogModel.find({ txHash }).sort({ _id: 1 }).exec();
  }
}
