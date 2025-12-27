import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '../../common/swagger.decorators';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { RoleMetadataOr } from '../../common/decorators/role-or.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { UserRole } from '../../common/enums/role.enum';
import { Permission } from '../../common/enums/permission.enum';
import { KycService } from './kyc.service';
import { UpdateKycProfileDto } from './dto/update-kyc-profile.dto';
import { UploadKycDocumentDto } from './dto/upload-kyc-document.dto';
import { SubmitKycApplicationDto } from './dto/submit-kyc-application.dto';
import { AdminFilterKycDto } from './dto/admin-filter-kyc.dto';
import { AdminOverrideKycStatusDto } from './dto/admin-override-kyc-status.dto';
import { KycWebhookDto } from './dto/kyc-webhook.dto';

@ApiTags('kyc')
@ApiBearerAuth()
@Controller('kyc')
export class KycController {
  constructor(private readonly kycService: KycService) {}

  @Get('profile')
  getMyProfile(@CurrentUser('sub') userId: string) {
    return this.kycService.getProfileForUser(userId);
  }

  @Patch('profile')
  updateMyProfile(
    @CurrentUser('sub') userId: string,
    @Body() dto: UpdateKycProfileDto,
  ) {
    return this.kycService.updateProfile(userId, dto);
  }

  @Post('documents')
  @UseInterceptors(FileInterceptor('file'))
  uploadDocument(
    @CurrentUser('sub') userId: string,
    @Body() dto: UploadKycDocumentDto,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.kycService.uploadDocument(userId, dto, file);
  }

  @Post('submit')
  submitMyKyc(
    @CurrentUser('sub') userId: string,
    @Body() dto: SubmitKycApplicationDto,
  ) {
    return this.kycService.submitForVerification(userId, dto);
  }

  @Get('admin/profiles')
  @RoleMetadataOr(UserRole.ADMIN)
  @Permissions(Permission.MANAGE_USERS)
  adminListProfiles(@Query() dto: AdminFilterKycDto) {
    return this.kycService.adminListProfiles(dto);
  }

  @Get('admin/profiles/:id')
  @RoleMetadataOr(UserRole.ADMIN)
  @Permissions(Permission.MANAGE_USERS)
  adminGetProfile(@Param('id') id: string) {
    return this.kycService.adminGetProfile(id);
  }

  @Post('admin/profiles/:id/override-status')
  @RoleMetadataOr(UserRole.ADMIN)
  @Permissions(Permission.MANAGE_USERS)
  adminOverrideStatus(
    @Param('id') id: string,
    @Body() dto: AdminOverrideKycStatusDto,
  ) {
    return this.kycService.adminOverrideStatus(id, dto);
  }

  @Post('admin/profiles/:id/sync')
  @RoleMetadataOr(UserRole.ADMIN)
  @Permissions(Permission.MANAGE_USERS)
  adminSyncFromProvider(@Param('id') id: string) {
    return this.kycService.syncStatusFromProvider(id);
  }

  @Public()
  @Post('webhook/:provider')
  providerWebhook(
    @Param('provider') provider: string,
    @Body() dto: KycWebhookDto,
  ) {
    return this.kycService.handleProviderWebhook(provider, dto);
  }
}
