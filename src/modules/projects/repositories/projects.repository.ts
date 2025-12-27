import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, UpdateQuery } from 'mongoose';
import { ProjectStatus } from '../../../common/enums/project-status.enum';
import { Project, ProjectDocument } from '../schemas/project.schema';

@Injectable()
export class ProjectsRepository {
  constructor(
    @InjectModel(Project.name)
    private readonly projectModel: Model<ProjectDocument>,
  ) {}

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
    return this.projectModel.findById(id).exec();
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
    return this.projectModel
      .find({ creatorId, ...filter })
      .sort({ createdAt: -1 })
      .exec();
  }

  query(
    filter: FilterQuery<ProjectDocument>,
    limit: number,
    skip: number,
  ): Promise<ProjectDocument[]> {
    return this.projectModel
      .find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
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
