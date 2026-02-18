import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  CharityDonation,
  CharityDonationDocument,
} from '../schemas/charity-donation.schema';

@Injectable()
export class CharityDonationsRepository {
  constructor(
    @InjectModel(CharityDonation.name)
    private readonly donationModel: Model<CharityDonationDocument>,
  ) {}

  create(payload: {
    projectId: Types.ObjectId;
    amount: number;
    donorName: string;
    message?: string | null;
  }): Promise<CharityDonationDocument> {
    return this.donationModel.create(payload);
  }

  listByProject(projectId: string, limit: number): Promise<CharityDonationDocument[]> {
    if (!Types.ObjectId.isValid(projectId)) {
      return Promise.resolve([]);
    }
    return this.donationModel
      .find({ projectId: new Types.ObjectId(projectId) })
      .sort({ createdAt: -1 })
      .limit(limit)
      .exec();
  }
}
