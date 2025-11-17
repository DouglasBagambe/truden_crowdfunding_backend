import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, UpdateQuery } from 'mongoose';
import {
  KycStatus,
  User,
  UserDocument,
  UserRole,
} from '../schemas/user.schema';

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
    return this.userModel.findById(id).exec();
  }

  findByPrimaryWallet(primaryWallet: string): Promise<UserDocument | null> {
    return this.userModel
      .findOne({ primaryWallet: primaryWallet.toLowerCase() })
      .exec();
  }

  findByWallet(wallet: string): Promise<UserDocument | null> {
    return this.userModel
      .findOne({
        $or: [
          { primaryWallet: wallet.toLowerCase() },
          { linkedWallets: wallet.toLowerCase() },
        ],
      })
      .exec();
  }

  query(
    filter: FilterQuery<UserDocument>,
    limit = 25,
    skip = 0,
  ): Promise<UserDocument[]> {
    return this.userModel.find(filter).skip(skip).limit(limit).exec();
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
      .findByIdAndUpdate(userId, { role }, { new: true })
      .exec();
  }

  updateKycStatus(
    userId: string,
    kycStatus: KycStatus,
  ): Promise<UserDocument | null> {
    return this.userModel
      .findByIdAndUpdate(userId, { kycStatus }, { new: true })
      .exec();
  }
}
