import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '../../common/swagger.decorators';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '../../common/enums/role.enum';
import { ProjectsService } from './projects.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { ProjectDecisionDto } from './dto/decision.dto';

@ApiTags('Admin Projects')
@Controller('admin/projects')
export class AdminProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Roles(UserRole.ADMIN, UserRole.SUPERADMIN, UserRole.APPROVER)
  @Get('pending')
  listPending() {
    return this.projectsService.listPendingProjects();
  }

  @Roles(UserRole.ADMIN, UserRole.SUPERADMIN, UserRole.APPROVER)
  @Post(':id/reviews')
  createReview(
    @Param('id') id: string,
    @CurrentUser('sub') reviewerId: string,
    @Body() dto: CreateReviewDto,
  ) {
    return this.projectsService.createReview(id, reviewerId, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.SUPERADMIN, UserRole.APPROVER)
  @Post(':id/decision')
  decide(@Param('id') id: string, @Body() dto: ProjectDecisionDto) {
    return this.projectsService.decide(id, dto);
  }
}
