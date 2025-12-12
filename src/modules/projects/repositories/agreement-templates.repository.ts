import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, UpdateQuery } from 'mongoose';
import { AgreementTemplate, AgreementTemplateDocument } from '../schemas/agreement-template.schema';
import { ProjectType } from '../../../common/enums/project-type.enum';

@Injectable()
export class AgreementTemplatesRepository {
  constructor(
    @InjectModel(AgreementTemplate.name)
    private readonly templateModel: Model<AgreementTemplateDocument>,
  ) {}

  create(payload: Partial<AgreementTemplate>): Promise<AgreementTemplateDocument> {
    return this.templateModel.create(payload);
  }

  async list(filter: FilterQuery<AgreementTemplateDocument> = {}) {
    return this.templateModel
      .find(filter)
      .sort({ createdAt: -1 })
      .exec();
  }

  async findActiveForProject(
    projectType: ProjectType,
    category?: string,
    industry?: string,
  ): Promise<AgreementTemplateDocument[]> {
    const filters: FilterQuery<AgreementTemplateDocument>[] = [
      { projectType, isActive: true, category: { $exists: false }, industry: { $exists: false } },
    ];

    if (category) {
      filters.push({ projectType, isActive: true, category });
    }
    if (industry) {
      filters.push({ projectType, isActive: true, industry });
    }

    return this.templateModel
      .find({ $or: filters })
      .sort({ category: -1, industry: -1, createdAt: -1 })
      .exec();
  }

  async updateById(
    id: string,
    update: UpdateQuery<AgreementTemplateDocument>,
  ): Promise<AgreementTemplateDocument | null> {
    return this.templateModel
      .findByIdAndUpdate(id, update, { new: true })
      .exec();
  }
}
