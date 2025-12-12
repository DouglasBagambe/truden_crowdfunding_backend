import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ProjectsController } from './projects.controller';
import { AdminProjectsController } from './admin-projects.controller';
import { ProjectsService } from './projects.service';
import { ProjectsRepository } from './repositories/projects.repository';
import { MilestonesRepository } from './repositories/milestones.repository';
import { AgreementTemplatesRepository } from './repositories/agreement-templates.repository';
import { AgreementTemplatesService } from './services/agreement-templates.service';
import { AdminAgreementsController } from './controllers/admin-agreements.controller';
import {
  Project,
  ProjectSchema,
  ROIProject,
  ROIProjectSchema,
  CharityProject,
  CharityProjectSchema,
} from './schemas/project.schema';
import { Milestone, MilestoneSchema } from './schemas/milestone.schema';
import { ProjectType } from '../../common/enums/project-type.enum';
import { UsersModule } from '../users/users.module';
import {
  AgreementTemplate,
  AgreementTemplateSchema,
} from './schemas/agreement-template.schema';

@Module({
  imports: [
    UsersModule,
    MongooseModule.forFeature([
      {
        name: Project.name,
        schema: ProjectSchema,
        discriminators: [
          { name: ProjectType.ROI, schema: ROIProjectSchema },
          { name: ProjectType.CHARITY, schema: CharityProjectSchema },
        ],
      },
      { name: Milestone.name, schema: MilestoneSchema },
      { name: AgreementTemplate.name, schema: AgreementTemplateSchema },
    ]),
  ],
  controllers: [
    ProjectsController,
    AdminProjectsController,
    AdminAgreementsController,
  ],
  providers: [
    ProjectsService,
    ProjectsRepository,
    MilestonesRepository,
    AgreementTemplatesRepository,
    AgreementTemplatesService,
  ],
  exports: [ProjectsService, AgreementTemplatesService],
})
export class ProjectsModule {}
