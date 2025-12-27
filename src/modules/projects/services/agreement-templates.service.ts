import { Injectable, NotFoundException } from '@nestjs/common';
import { UpdateQuery } from 'mongoose';
import { AgreementTemplatesRepository } from '../repositories/agreement-templates.repository';
import { CreateAgreementTemplateDto } from '../dto/create-agreement-template.dto';
import { UpdateAgreementTemplateDto } from '../dto/update-agreement-template.dto';
import { ProjectType } from '../../../common/enums/project-type.enum';
import { AgreementTemplateDocument } from '../schemas/agreement-template.schema';

@Injectable()
export class AgreementTemplatesService {
  constructor(
    private readonly templatesRepo: AgreementTemplatesRepository,
  ) {}

  create(dto: CreateAgreementTemplateDto) {
    return this.templatesRepo.create({
      projectType: dto.projectType,
      category: dto.category,
      industry: dto.industry,
      title: dto.title,
      description: dto.description,
      requiresAcceptance: dto.requiresAcceptance ?? true,
      isActive: dto.isActive ?? true,
    });
  }

  list(filter: {
    projectType?: ProjectType;
    category?: string;
    industry?: string;
    isActive?: boolean;
  }) {
    const query: Record<string, unknown> = {};
    if (filter.projectType) query.projectType = filter.projectType;
    if (filter.category) query.category = filter.category;
    if (filter.industry) query.industry = filter.industry;
    if (filter.isActive !== undefined) query.isActive = filter.isActive;
    return this.templatesRepo.list(query);
  }

  async update(id: string, dto: UpdateAgreementTemplateDto) {
    const update: UpdateQuery<AgreementTemplateDocument> = {};
    if (dto.title !== undefined) update.title = dto.title;
    if (dto.description !== undefined) update.description = dto.description;
    if (dto.requiresAcceptance !== undefined)
      update.requiresAcceptance = dto.requiresAcceptance;
    if (dto.isActive !== undefined) update.isActive = dto.isActive;
    if (dto.projectType !== undefined) update.projectType = dto.projectType;
    if (dto.category !== undefined) update.category = dto.category;
    if (dto.industry !== undefined) update.industry = dto.industry;
    if (dto.bumpVersion) {
      update.$inc = { version: 1 };
    }

    const updated = await this.templatesRepo.updateById(id, update);
    if (!updated) throw new NotFoundException('Agreement template not found');
    return updated;
  }

  findApplicable(
    projectType: ProjectType,
    category?: string,
    industry?: string,
  ) {
    return this.templatesRepo.findActiveForProject(
      projectType,
      category,
      industry,
    );
  }
}
