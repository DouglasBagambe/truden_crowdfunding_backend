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
import { AgreementTemplatesService } from '../services/agreement-templates.service';
import { CreateAgreementTemplateDto } from '../dto/create-agreement-template.dto';
import { UpdateAgreementTemplateDto } from '../dto/update-agreement-template.dto';
import { ProjectType } from '../../../common/enums/project-type.enum';

@ApiTags('Admin Project Agreements')
@Controller('admin/projects/agreements')
export class AdminAgreementsController {
  constructor(private readonly templatesService: AgreementTemplatesService) {}

  @Roles(UserRole.ADMIN, UserRole.SUPERADMIN, UserRole.APPROVER)
  @Post()
  create(@Body() dto: CreateAgreementTemplateDto) {
    return this.templatesService.create(dto);
  }

  @Roles(UserRole.ADMIN, UserRole.SUPERADMIN, UserRole.APPROVER)
  @Get()
  list(
    @Query('projectType') projectType?: ProjectType,
    @Query('category') category?: string,
    @Query('industry') industry?: string,
    @Query('isActive') isActive?: string,
  ) {
    const activeFlag =
      isActive === undefined
        ? undefined
        : isActive === 'true' || isActive === '1';
    return this.templatesService.list({
      projectType,
      category,
      industry,
      isActive: activeFlag,
    });
  }

  @Roles(UserRole.ADMIN, UserRole.SUPERADMIN, UserRole.APPROVER)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateAgreementTemplateDto) {
    return this.templatesService.update(id, dto);
  }
}
