import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Milestone, MilestoneDocument } from '../schemas/milestone.schema';

@Injectable()
export class MilestonesRepository {
  constructor(
    @InjectModel(Milestone.name)
    private readonly milestoneModel: Model<MilestoneDocument>,
  ) {}

  createMany(
    projectId: string,
    milestones: Array<Omit<Milestone, 'projectId'>>,
  ) {
    return this.milestoneModel.insertMany(
      milestones.map((milestone) => ({
        ...milestone,
        projectId,
      })),
    );
  }

  deleteByProject(projectId: string) {
    return this.milestoneModel.deleteMany({ projectId }).exec();
  }

  findByProject(projectId: string): Promise<MilestoneDocument[]> {
    return this.milestoneModel
      .find({ projectId })
      .sort({ createdAt: 1 })
      .exec();
  }

  findByIdForProject(
    projectId: string,
    milestoneId: string,
  ): Promise<MilestoneDocument | null> {
    return this.milestoneModel.findOne({ _id: milestoneId, projectId }).exec();
  }
}
