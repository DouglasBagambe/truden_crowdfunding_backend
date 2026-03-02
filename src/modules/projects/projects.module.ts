import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ProjectsController } from './controllers/projects.controller';
import { AdminProjectsController } from './controllers/admin-projects.controller';
import { ProjectsService } from './projects.service';
import { ProjectsRepository } from './repositories/projects.repository';
import { MilestonesRepository } from './repositories/milestones.repository';
import { AgreementTemplatesRepository } from './repositories/agreement-templates.repository';
import { AgreementTemplatesService } from './services/agreement-templates.service';
import { AdminAgreementsController } from './controllers/admin-agreements.controller';
import {
  AttachmentRequirement,
  AttachmentRequirementSchema,
} from './schemas/attachment-requirement.schema';
import { AttachmentRequirementsRepository } from './repositories/attachment-requirements.repository';
import { AttachmentRequirementsService } from './services/attachment-requirements.service';
import { AdminAttachmentsController } from './controllers/admin-attachments.controller';
import {
  ProjectAttachmentFile,
  ProjectAttachmentFileSchema,
} from './schemas/attachment-file.schema';
import { AttachmentFilesRepository } from './repositories/attachment-files.repository';
import {
  Project,
  ProjectSchema,
  ROIProjectSchema,
  CharityProjectSchema,
} from './schemas/project.schema';
import {
  CharityDonation,
  CharityDonationSchema,
} from './schemas/charity-donation.schema';
import { Milestone, MilestoneSchema } from './schemas/milestone.schema';
import { ProjectType } from '../../common/enums/project-type.enum';
import { UsersModule } from '../users/users.module';
import {
  AgreementTemplate,
  AgreementTemplateSchema,
} from './schemas/agreement-template.schema';
import { CharityDonationsRepository } from './repositories/charity-donations.repository';

import { Investment, InvestmentSchema } from '../investments/schemas/investment.schema';
import { InvestmentStatus } from '../investments/interfaces/investment.interface';

@Module({
  imports: [
    UsersModule,
    MongooseModule.forFeature([
      { name: Investment.name, schema: InvestmentSchema },
      {
        name: Project.name,
        schema: ProjectSchema,
        discriminators: [
          { name: ProjectType.ROI, schema: ROIProjectSchema },
          { name: ProjectType.CHARITY, schema: CharityProjectSchema },
        ],
      },
      { name: Milestone.name, schema: MilestoneSchema },
      { name: CharityDonation.name, schema: CharityDonationSchema },
      { name: AgreementTemplate.name, schema: AgreementTemplateSchema },
      {
        name: AttachmentRequirement.name,
        schema: AttachmentRequirementSchema,
      },
      {
        name: ProjectAttachmentFile.name,
        schema: ProjectAttachmentFileSchema,
      },
    ]),
  ],
  controllers: [
    ProjectsController,
    AdminProjectsController,
    AdminAgreementsController,
    AdminAttachmentsController,
  ],
  providers: [
    ProjectsService,
    ProjectsRepository,
    MilestonesRepository,
    CharityDonationsRepository,
    AgreementTemplatesRepository,
    AgreementTemplatesService,
    AttachmentRequirementsRepository,
    AttachmentRequirementsService,
    AttachmentFilesRepository,
  ],
  exports: [
    ProjectsService,
    AgreementTemplatesService,
    AttachmentRequirementsService,
    AttachmentFilesRepository,
  ],
})
export class ProjectsModule { }
