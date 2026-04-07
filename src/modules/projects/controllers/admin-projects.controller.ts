import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiTags } from '../../../common/swagger.decorators';
import { Permissions } from '../../../common/decorators/permissions.decorator';
import { RoleMetadataOr } from '../../../common/decorators/role-or.decorator';
import { Permission } from '../../../common/enums/permission.enum';
import { UserRole } from '../../../common/enums/role.enum';
import { ProjectsService } from '../projects.service';
import { ProjectDecisionDto } from '../dto/decision.dto';
import { CreateVerificationLogDto } from '../dto/create-verification-log.dto';
import { RequestAttachmentDto } from '../dto/request-attachment.dto';

@ApiTags('Admin Projects')
@Controller('admin/projects')
export class AdminProjectsController {
  constructor(private readonly projectsService: ProjectsService) { }

  @RoleMetadataOr(UserRole.ADMIN, UserRole.APPROVER)
  @Permissions(Permission.REVIEW_PROJECTS)
  @Get('all')
  listAll() {
    return this.projectsService.listAllProjectsForAdmin();
  }

  @RoleMetadataOr(UserRole.ADMIN, UserRole.APPROVER)
  @Permissions(Permission.REVIEW_PROJECTS)
  @Get('pending')
  listPending() {
    return this.projectsService.listPendingProjects();
  }

  @RoleMetadataOr(UserRole.ADMIN, UserRole.APPROVER)
  @Permissions(Permission.APPROVE_PROJECTS)
  @Post(':id/decision')
  decide(@Param('id') id: string, @Body() dto: ProjectDecisionDto) {
    return this.projectsService.decide(id, dto);
  }

  @RoleMetadataOr(UserRole.ADMIN, UserRole.APPROVER)
  @Permissions(Permission.REVIEW_PROJECTS)
  @Post(':id/verification-logs')
  addVerificationLog(
    @Param('id') id: string,
    @Body() dto: CreateVerificationLogDto,
  ) {
    return this.projectsService.addVerificationLog(id, dto);
  }

  @RoleMetadataOr(UserRole.ADMIN, UserRole.APPROVER)
  @Permissions(Permission.REVIEW_PROJECTS)
  @Get(':id/verification-logs')
  getVerificationLogs(@Param('id') id: string) {
    return this.projectsService.listVerificationLogs(id);
  }

  @RoleMetadataOr(UserRole.ADMIN, UserRole.APPROVER)
  @Permissions(Permission.REVIEW_PROJECTS)
  @Post(':id/attachment-requests')
  requestAttachment(
    @Param('id') id: string,
    @Body() dto: RequestAttachmentDto,
  ) {
    return this.projectsService.requestAttachment(id, dto);
  }
}
