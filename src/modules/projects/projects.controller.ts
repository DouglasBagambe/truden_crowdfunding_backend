import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '../../common/swagger.decorators';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { QueryProjectsDto } from './dto/query-projects.dto';
import { ProjectsService } from './projects.service';

@ApiTags('Projects')
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  createProject(
    @CurrentUser('sub') creatorId: string,
    @Body() dto: CreateProjectDto,
  ) {
    return this.projectsService.createProject(creatorId, dto);
  }

  @Put(':id')
  updateProject(
    @Param('id') id: string,
    @CurrentUser('sub') creatorId: string,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.projectsService.updateProject(id, creatorId, dto);
  }

  @Post(':id/submit')
  submitProject(
    @Param('id') id: string,
    @CurrentUser('sub') creatorId: string,
  ) {
    return this.projectsService.submitProject(id, creatorId);
  }

  @Get('me')
  getMyProjects(@CurrentUser('sub') creatorId: string) {
    return this.projectsService.listMyProjects(creatorId);
  }

  @Get(':id/owner')
  getOwnedProject(
    @Param('id') id: string,
    @CurrentUser('sub') creatorId: string,
  ) {
    return this.projectsService.getProjectOwnerView(id, creatorId);
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
