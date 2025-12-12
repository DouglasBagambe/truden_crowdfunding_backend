import { Injectable, NotFoundException } from '@nestjs/common';
import { UpdateQuery } from 'mongoose';
import { AttachmentRequirementsRepository } from '../repositories/attachment-requirements.repository';
import { CreateAttachmentRequirementDto } from '../dto/create-attachment-requirement.dto';
import { UpdateAttachmentRequirementDto } from '../dto/update-attachment-requirement.dto';
import { ProjectType } from '../../../common/enums/project-type.enum';
import { AttachmentRequirementDocument } from '../schemas/attachment-requirement.schema';

@Injectable()
export class AttachmentRequirementsService {
  constructor(
    private readonly requirementsRepo: AttachmentRequirementsRepository,
  ) {}

  create(dto: CreateAttachmentRequirementDto) {
    return this.requirementsRepo.create({
      projectType: dto.projectType,
      category: dto.category,
      subcategory: dto.subcategory,
      industry: dto.industry,
      title: dto.title,
      description: dto.description,
      isRequired: dto.isRequired ?? true,
      isActive: dto.isActive ?? true,
    });
  }

  list(filter: {
    projectType?: ProjectType;
    category?: string;
    subcategory?: string;
    industry?: string;
    isActive?: boolean;
  }) {
    const query: Record<string, unknown> = {};
    if (filter.projectType) query.projectType = filter.projectType;
    if (filter.category) query.category = filter.category;
    if (filter.subcategory) query.subcategory = filter.subcategory;
    if (filter.industry) query.industry = filter.industry;
    if (filter.isActive !== undefined) query.isActive = filter.isActive;
    return this.requirementsRepo.list(query);
  }

  async update(id: string, dto: UpdateAttachmentRequirementDto) {
    const update: UpdateQuery<AttachmentRequirementDocument> = {};
    if (dto.title !== undefined) update.title = dto.title;
    if (dto.description !== undefined) update.description = dto.description;
    if (dto.isRequired !== undefined) update.isRequired = dto.isRequired;
    if (dto.isActive !== undefined) update.isActive = dto.isActive;
    if (dto.projectType !== undefined) update.projectType = dto.projectType;
    if (dto.category !== undefined) update.category = dto.category;
    if (dto.subcategory !== undefined) update.subcategory = dto.subcategory;
    if (dto.industry !== undefined) update.industry = dto.industry;
    if (dto.bumpVersion) {
      update.$inc = { version: 1 };
    }

    const updated = await this.requirementsRepo.updateById(id, update);
    if (!updated) throw new NotFoundException('Attachment requirement not found');
    return updated;
  }

  findApplicable(
    projectType: ProjectType,
    category?: string,
    subcategory?: string,
    industry?: string,
  ) {
    return this.requirementsRepo.findActiveForProject(
      projectType,
      category,
      subcategory,
      industry,
    );
  }
}
