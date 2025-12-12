import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Roles } from '../../../common/decorators/roles.decorator';
import { UserRole } from '../../../common/enums/role.enum';
import { ApiTags } from '../../../common/swagger.decorators';
import { AttachmentRequirementsService } from '../services/attachment-requirements.service';
import { CreateAttachmentRequirementDto } from '../dto/create-attachment-requirement.dto';
import { UpdateAttachmentRequirementDto } from '../dto/update-attachment-requirement.dto';
import { ProjectType } from '../../../common/enums/project-type.enum';

@ApiTags('Admin Project Attachment Requirements')
@Controller('admin/projects/attachments')
export class AdminAttachmentsController {
  constructor(
    private readonly requirementsService: AttachmentRequirementsService,
  ) {}

  @Roles(UserRole.ADMIN, UserRole.SUPERADMIN, UserRole.APPROVER)
  @Post()
  create(@Body() dto: CreateAttachmentRequirementDto) {
    return this.requirementsService.create(dto);
  }

  @Roles(UserRole.ADMIN, UserRole.SUPERADMIN, UserRole.APPROVER)
  @Get()
  list(
    @Query('projectType') projectType?: ProjectType,
    @Query('category') category?: string,
    @Query('subcategory') subcategory?: string,
    @Query('industry') industry?: string,
    @Query('isActive') isActive?: string,
  ) {
    const activeFlag =
      isActive === undefined
        ? undefined
        : isActive === 'true' || isActive === '1';
    return this.requirementsService.list({
      projectType,
      category,
      subcategory,
      industry,
      isActive: activeFlag,
    });
  }

  @Roles(UserRole.ADMIN, UserRole.SUPERADMIN, UserRole.APPROVER)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateAttachmentRequirementDto) {
    return this.requirementsService.update(id, dto);
  }
}
