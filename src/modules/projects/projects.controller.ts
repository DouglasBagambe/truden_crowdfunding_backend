import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '../../common/swagger.decorators';
import { Roles } from '../../common/decorators/roles.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { UserRole } from '../../common/enums/role.enum';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { QueryProjectsDto } from './dto/query-projects.dto';
import { ProjectsService } from './projects.service';

@ApiTags('Projects')
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Roles(UserRole.INNOVATOR)
  @Post()
  createProject(
    @CurrentUser('sub') creatorId: string,
    @Body() dto: CreateProjectDto,
  ) {
    return this.projectsService.createProject(creatorId, dto);
  }

  @Roles(UserRole.INNOVATOR)
  @Put(':id')
  updateProject(
    @Param('id') id: string,
    @CurrentUser('sub') creatorId: string,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.projectsService.updateProject(id, creatorId, dto);
  }

  @Roles(UserRole.INNOVATOR)
  @Post(':id/submit')
  submitProject(
    @Param('id') id: string,
    @CurrentUser('sub') creatorId: string,
  ) {
    return this.projectsService.submitProject(id, creatorId);
  }

  @Roles(UserRole.INNOVATOR)
  @Get('me')
  getMyProjects(@CurrentUser('sub') creatorId: string) {
    return this.projectsService.listMyProjects(creatorId);
  }

  @Public()
  @Get()
  listProjects(@Query() query: QueryProjectsDto) {
    return this.projectsService.listPublicProjects(query);
  }

  @Public()
  @Get(':id')
  getProject(@Param('id') id: string) {
    return this.projectsService.getProjectPublic(id);
  }

  @Public()
  @Get(':id/milestones')
  getProjectMilestones(@Param('id') id: string) {
    return this.projectsService.getMilestonesPublic(id);
  }
}
