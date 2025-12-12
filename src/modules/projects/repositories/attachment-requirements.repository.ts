import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, UpdateQuery } from 'mongoose';
import {
  AttachmentRequirement,
  AttachmentRequirementDocument,
} from '../schemas/attachment-requirement.schema';
import { ProjectType } from '../../../common/enums/project-type.enum';

@Injectable()
export class AttachmentRequirementsRepository {
  constructor(
    @InjectModel(AttachmentRequirement.name)
    private readonly requirementModel: Model<AttachmentRequirementDocument>,
  ) {}

  create(payload: Partial<AttachmentRequirement>) {
    return this.requirementModel.create(payload);
  }

  list(filter: FilterQuery<AttachmentRequirementDocument> = {}) {
    return this.requirementModel
      .find(filter)
      .sort({ createdAt: -1 })
      .exec();
  }

  async findActiveForProject(
    projectType: ProjectType,
    category?: string,
    subcategory?: string,
    industry?: string,
  ): Promise<AttachmentRequirementDocument[]> {
    const filters: FilterQuery<AttachmentRequirementDocument>[] = [
      { projectType, isActive: true, category: { $exists: false }, industry: { $exists: false }, subcategory: { $exists: false } },
    ];

    if (category) {
      filters.push({ projectType, isActive: true, category });
    }
    if (subcategory) {
      filters.push({ projectType, isActive: true, category, subcategory });
    }
    if (industry) {
      filters.push({ projectType, isActive: true, industry });
    }

    return this.requirementModel
      .find({ $or: filters })
      .sort({ category: -1, subcategory: -1, industry: -1, createdAt: -1 })
      .exec();
  }

  updateById(
    id: string,
    update: UpdateQuery<AttachmentRequirementDocument>,
  ) {
    return this.requirementModel
      .findByIdAndUpdate(id, update, { new: true })
      .exec();
  }
}
