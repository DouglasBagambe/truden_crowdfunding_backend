import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, UpdateQuery, Types } from 'mongoose';
import { ProjectStatus } from '../../../common/enums/project-status.enum';
import { ProjectType } from '../../../common/enums/project-type.enum';
import { Project, ProjectDocument } from '../schemas/project.schema';

@Injectable()
export class ProjectsRepository {
  constructor(
    @InjectModel(Project.name)
    private readonly projectModel: Model<ProjectDocument>,
  ) {}

  resetRevertedProvisioning(id: string, nonce: number) {
    return this.projectModel
      .findOneAndUpdate(
        {
          _id: id,
          status: ProjectStatus.APPROVED,
          onchainProvisioningStatus: 'AWAITING_CREATOR',
          provisioningNonce: nonce,
        },
        {
          $unset: {
            provisioningNonce: 1,
            provisioningCreator: 1,
            provisioningEscrow: 1,
            provisioningCalldata: 1,
            provisioningTransactionHash: 1,
          },
          $set: {
            onchainProvisioningError:
              'Prior creator transaction reverted. A new signing plan may now be prepared.',
          },
        },
        { new: true },
      )
      .exec();
  }

  reserveProvisioningPlan(
    id: string,
    plan: { nonce: number; account: string; to: string; data: string },
  ) {
    return this.projectModel
      .findOneAndUpdate(
        {
          _id: id,
          status: ProjectStatus.APPROVED,
          onchainProvisioningStatus: 'AWAITING_CREATOR',
          provisioningNonce: { $exists: false },
        },
        {
          $set: {
            provisioningNonce: plan.nonce,
            provisioningCreator: plan.account.toLowerCase(),
            provisioningEscrow: plan.to.toLowerCase(),
            provisioningCalldata: plan.data.toLowerCase(),
          },
        },
        { new: true },
      )
      .exec();
  }

  reserveProvisioningTransaction(id: string, hash: string) {
    return this.projectModel
      .findOneAndUpdate(
        {
          _id: id,
          status: ProjectStatus.APPROVED,
          onchainProvisioningStatus: 'AWAITING_CREATOR',
          $or: [
            { provisioningTransactionHash: { $exists: false } },
            { provisioningTransactionHash: hash.toLowerCase() },
          ],
        },
        { $set: { provisioningTransactionHash: hash.toLowerCase() } },
        { new: true },
      )
      .exec();
  }

  confirmProvisioning(
    id: string,
    hash: string,
    campaignId: string,
    escrow: string,
  ) {
    return this.projectModel
      .findOneAndUpdate(
        {
          _id: id,
          status: ProjectStatus.APPROVED,
          onchainProvisioningStatus: 'AWAITING_CREATOR',
          provisioningTransactionHash: hash.toLowerCase(),
        },
        {
          $set: {
            status: ProjectStatus.FUNDING,
            projectOnchainId: campaignId,
            provisioningTransactionHash: hash.toLowerCase(),
            provisioningEscrow: escrow.toLowerCase(),
            onchainProvisioningStatus: 'READY',
            onchainProvisionedAt: new Date(),
          },
          $unset: { onchainProvisioningError: 1 },
        },
        { new: true },
      )
      .exec();
  }

  create(payload: Partial<Project>): Promise<ProjectDocument> {
    const discriminatorType = payload.projectType;
    const discriminatorModel =
      discriminatorType && this.projectModel.discriminators
        ? this.projectModel.discriminators[discriminatorType]
        : null;

    if (discriminatorModel) {
      return (discriminatorModel as Model<ProjectDocument>).create(payload);
    }

    return this.projectModel.create(payload);
  }

  findById(id: string): Promise<ProjectDocument | null> {
    return this.projectModel
      .findById(id)
      .populate('creatorId', 'profile email')
      .exec();
  }

  findByOnchainId(projectOnchainId: string): Promise<ProjectDocument | null> {
    return this.projectModel
      .findOne({ projectOnchainId: String(projectOnchainId) })
      .populate('creatorId', 'profile email')
      .exec();
  }

  listRoiProjectsWithOnchainId(): Promise<ProjectDocument[]> {
    return this.projectModel
      .find({
        projectType: ProjectType.ROI,
        projectOnchainId: { $exists: true, $ne: null },
      })
      .select('projectOnchainId')
      .exec();
  }

  updateById(
    id: string,
    update: UpdateQuery<ProjectDocument>,
  ): Promise<ProjectDocument | null> {
    return this.projectModel
      .findByIdAndUpdate(id, update, { new: true })
      .exec();
  }

  findByCreator(
    creatorId: string,
    filter: FilterQuery<ProjectDocument> = {},
  ): Promise<ProjectDocument[]> {
    let objectId: Types.ObjectId | undefined;
    try {
      objectId = new Types.ObjectId(creatorId);
    } catch {
      // Invalid legacy identifiers are queried only as strings.
    }

    const conditions: any[] = [];
    conditions.push({ creatorId });
    if (objectId) {
      conditions.push({ creatorId: objectId });
    }

    return this.projectModel
      .find({
        $or: conditions,
        ...filter,
      })
      .sort({ createdAt: -1 })
      .exec();
  }

  query(
    filter: FilterQuery<ProjectDocument>,
    limit: number,
    skip: number,
    sort: Record<string, 1 | -1> = { createdAt: -1, _id: -1 },
  ): Promise<ProjectDocument[]> {
    return this.projectModel
      .find(filter)
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .populate('creatorId', 'profile email')
      .exec();
  }

  count(filter: FilterQuery<ProjectDocument>): Promise<number> {
    return this.projectModel.countDocuments(filter).exec();
  }

  setStatus(
    id: string,
    status: ProjectStatus,
    reason?: string | null,
  ): Promise<ProjectDocument | null> {
    const setPayload: UpdateQuery<ProjectDocument> = {
      $set: { status },
    };
    if (reason !== undefined && reason !== null && setPayload.$set) {
      (setPayload.$set as Partial<Project>).decisionReason = reason;
    }
    return this.updateById(id, setPayload);
  }
}
