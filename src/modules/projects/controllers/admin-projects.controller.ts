import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '../../../common/swagger.decorators';
import { Roles } from '../../../common/decorators/roles.decorator';
import { UserRole } from '../../../common/enums/role.enum';
import { ProjectsService } from '../projects.service';
import { ProjectDecisionDto } from '../dto/decision.dto';
import { CreateVerificationLogDto } from '../dto/create-verification-log.dto';
import { RequestAttachmentDto } from '../dto/request-attachment.dto';

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
  @Post(':id/decision')
  decide(@Param('id') id: string, @Body() dto: ProjectDecisionDto) {
    return this.projectsService.decide(id, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.SUPERADMIN, UserRole.APPROVER)
  @Post(':id/verification-logs')
  addVerificationLog(
    @Param('id') id: string,
    @Body() dto: CreateVerificationLogDto,
  ) {
    return this.projectsService.addVerificationLog(id, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.SUPERADMIN, UserRole.APPROVER)
  @Get(':id/verification-logs')
  getVerificationLogs(@Param('id') id: string) {
    return this.projectsService.listVerificationLogs(id);
  }

  @Roles(UserRole.ADMIN, UserRole.SUPERADMIN, UserRole.APPROVER)
  @Post(':id/attachment-requests')
  requestAttachment(
    @Param('id') id: string,
    @Body() dto: RequestAttachmentDto,
  ) {
    return this.projectsService.requestAttachment(id, dto);
  }
}
