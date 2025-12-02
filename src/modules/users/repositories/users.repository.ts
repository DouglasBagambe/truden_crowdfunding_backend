import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, UpdateQuery } from 'mongoose';
import { KYCStatus, UserRole } from '../../../common/enums/role.enum';
import { User, UserDocument } from '../schemas/user.schema';

@Injectable()
export class UsersRepository {
  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
  ) {}

  create(payload: Partial<User>): Promise<UserDocument> {
    return this.userModel.create(payload);
  }

  findById(id: string): Promise<UserDocument | null> {
    return this.userModel.findById(id).select('-passwordHash').exec();
  }

  findByWallet(wallet: string): Promise<UserDocument | null> {
    return this.userModel
      .findOne({
        $or: [
          { primaryWallet: wallet.toLowerCase() },
          { linkedWallets: wallet.toLowerCase() },
        ],
      })
      .select('-passwordHash')
      .exec();
  }

  findByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel
      .findOne({ email: email.toLowerCase().trim() })
      .select('-passwordHash')
      .exec();
  }

  query(
    filter: FilterQuery<UserDocument>,
    limit = 25,
    skip = 0,
  ): Promise<UserDocument[]> {
    return this.userModel
      .find(filter)
      .skip(skip)
      .limit(limit)
      .select('-passwordHash')
      .exec();
  }

  count(filter: FilterQuery<UserDocument>): Promise<number> {
    return this.userModel.countDocuments(filter).exec();
  }

  updateById(
    id: string,
    update: UpdateQuery<UserDocument>,
  ): Promise<UserDocument | null> {
    return this.userModel.findByIdAndUpdate(id, update, { new: true }).exec();
  }

  addLinkedWallet(
    userId: string,
    wallet: string,
  ): Promise<UserDocument | null> {
    return this.userModel
      .findByIdAndUpdate(
        userId,
        { $addToSet: { linkedWallets: wallet.toLowerCase() } },
        { new: true },
      )
      .exec();
  }

  removeLinkedWallet(
    userId: string,
    wallet: string,
  ): Promise<UserDocument | null> {
    return this.userModel
      .findByIdAndUpdate(
        userId,
        { $pull: { linkedWallets: wallet.toLowerCase() } },
        { new: true },
      )
      .exec();
  }

  updateRole(userId: string, role: UserRole): Promise<UserDocument | null> {
    return this.userModel
      .findByIdAndUpdate(userId, { roles: [role] }, { new: true })
      .exec();
  }

  updateKycStatus(
    userId: string,
    kycStatus: KYCStatus,
  ): Promise<UserDocument | null> {
    return this.userModel
      .findByIdAndUpdate(
        userId,
        { kycStatus, 'kyc.status': kycStatus },
        { new: true },
      )
      .exec();
  }

  updateCreatorVerificationStatus(
    userId: string,
    status: string,
    reason?: string,
  ): Promise<UserDocument | null> {
    const setPayload: Record<string, unknown> = {
      'creatorVerification.status': status,
      'creatorVerification.failureReason': reason,
    };
    if (status === 'VERIFIED') {
      setPayload['creatorVerification.verifiedAt'] = new Date();
    }
    return this.userModel
      .findByIdAndUpdate(userId, { $set: setPayload }, { new: true })
      .exec();
  }
}
