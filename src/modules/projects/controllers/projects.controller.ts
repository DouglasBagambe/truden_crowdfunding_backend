import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { ApiTags } from '../../../common/swagger.decorators';
import { Public } from '../../../common/decorators/public.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { UserRole } from '../../../common/enums/role.enum';
import { CreateProjectDto } from '../dto/create-project.dto';
import { UpdateProjectDto } from '../dto/update-project.dto';
import { QueryProjectsDto } from '../dto/query-projects.dto';
import { UploadAttachmentDto } from '../dto/upload-attachment.dto';
import { CreateCharityDonationDto } from '../dto/create-charity-donation.dto';
import { ProjectsService } from '../projects.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { EmailVerifiedGuard } from '../../../common/guards/email-verified.guard';
type MulterFile = Express.Multer.File;

@ApiTags('Projects')
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) { }

  // ── Static / non-parameterized routes FIRST ──────────────────────────────

  @Post()
  @UseGuards(EmailVerifiedGuard)
  createProject(
    @CurrentUser('sub') creatorId: string,
    @Body() dto: CreateProjectDto,
  ) {
    return this.projectsService.createProject(creatorId, dto);
  }

  @Get('me')
  getMyProjects(@CurrentUser('sub') creatorId: string) {
    return this.projectsService.listMyProjects(creatorId);
  }

  @Public()
  @Get()
  listProjects(@Query() query: QueryProjectsDto) {
    return this.projectsService.listPublicProjects(query);
  }

  /** Generic media upload – any authenticated user can upload */
  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  uploadGenericMedia(@UploadedFile() file: MulterFile) {
    return this.projectsService.uploadGenericFile(file);
  }

  /** Serve uploaded files publicly */
  @Public()
  @Get('files/:fileId')
  async downloadGenericFile(@Param('fileId') fileId: string) {
    return this.projectsService.downloadGenericFile(fileId);
  }

  // ── Parameterized routes AFTER static ones ────────────────────────────────

  @Put(':id')
  updateProject(
    @Param('id') id: string,
    @CurrentUser('sub') creatorId: string,
    @Body() dto: UpdateProjectDto,
  ) {
    return this.projectsService.updateProject(id, creatorId, dto);
  }

  @Post(':id/submit')
  @UseGuards(EmailVerifiedGuard)
  submitProject(
    @Param('id') id: string,
    @CurrentUser('sub') creatorId: string,
  ) {
    return this.projectsService.submitProject(id, creatorId);
  }

  @Get(':id/owner')
  getOwnedProject(
    @Param('id') id: string,
    @CurrentUser('sub') creatorId: string,
  ) {
    return this.projectsService.getProjectOwnerView(id, creatorId);
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

  @Public()


  @Public()
  @Get(':id/donors')
  listDonors(@Param('id') id: string, @Query('limit') limit?: string) {
    return this.projectsService.listCharityDonationsPublic(id, Number(limit) || 50);
  }

  @Roles(UserRole.INNOVATOR, UserRole.ADMIN)
  @Post(':id/attachments/upload')
  @UseInterceptors(FileInterceptor('file'))
  uploadAttachment(
    @Param('id') id: string,
    @CurrentUser('sub') userId: string,
    @UploadedFile() file: MulterFile,
    @Body() dto: UploadAttachmentDto,
  ) {
    return this.projectsService.uploadAttachment(id, userId, dto, file);
  }

  @Roles(UserRole.INNOVATOR, UserRole.ADMIN)
  @Get(':id/attachments/:fileId/download')
  downloadAttachment(@Param('id') id: string, @Param('fileId') fileId: string) {
    return this.projectsService.downloadAttachment(id, fileId);
  }
}
