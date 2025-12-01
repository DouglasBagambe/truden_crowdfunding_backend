import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ProjectsController } from './projects.controller';
import { AdminProjectsController } from './admin-projects.controller';
import { ProjectsService } from './projects.service';
import { ProjectsRepository } from './repositories/projects.repository';
import { MilestonesRepository } from './repositories/milestones.repository';
import { ProjectReviewsRepository } from './repositories/project-reviews.repository';
import {
  Project,
  ProjectSchema,
  ROIProject,
  ROIProjectSchema,
  CharityProject,
  CharityProjectSchema,
} from './schemas/project.schema';
import { Milestone, MilestoneSchema } from './schemas/milestone.schema';
import {
  ProjectReview,
  ProjectReviewSchema,
} from './schemas/project-review.schema';
import { ProjectType } from '../../common/enums/project-type.enum';

@Module({
  imports: [
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
      { name: ProjectReview.name, schema: ProjectReviewSchema },
    ]),
  ],
  controllers: [ProjectsController, AdminProjectsController],
  providers: [
    ProjectsService,
    ProjectsRepository,
    MilestonesRepository,
    ProjectReviewsRepository,
  ],
  exports: [ProjectsService],
})
export class ProjectsModule {}
