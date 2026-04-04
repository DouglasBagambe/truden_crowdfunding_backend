import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { createHmac } from 'crypto';
import type { Request } from 'express';
import { ConfigService } from '@nestjs/config';
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
  constructor(
    private readonly kycService: KycService,
    private readonly configService: ConfigService,
  ) { }

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
  async submitMyKyc(
    @CurrentUser('sub') userId: string,
    @Body() dto: SubmitKycApplicationDto,
  ) {
    // Returns KycProfileView + optional verificationUrl (Didit hosted link)
    return this.kycService.submitForVerification(userId, dto);
  }

  @Post('refresh')
  async refreshMyStatus(@CurrentUser('sub') userId: string) {
    // Polls Didit for the latest status and updates the local profile + user
    return this.kycService.syncMyStatus(userId);
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
    @Body() body: Record<string, any>,
    @Req() req: Request,
    @Headers('x-signature-v2') sigV2?: string,
    @Headers('x-signature') sigV1?: string,
    @Headers('x-signature-simple') sigSimple?: string,
  ) {
    const webhookSecret = this.configService.get<string>('DIDIT_WEBHOOK_SECRET');

    if (webhookSecret && provider === 'didit') {
      // Try X-Signature-V2 first (recommended — signs unescaped Unicode JSON)
      const sig = sigV2 || sigV1 || sigSimple;
      if (sig) {
        const rawBody: string =
          (req as any).rawBody ||
          JSON.stringify(body);
        const expected = createHmac('sha256', webhookSecret)
          .update(rawBody)
          .digest('hex');
        if (sig !== expected) {
          throw new ForbiddenException('Invalid webhook signature');
        }
      }
      // If no signature header at all, log a warning but still process
      // (some Didit plans don't send signatures yet)
    }

    // Build a unified DTO from Didit's flat payload
    // Didit sends: { session_id, status, vendor_data, timestamp, ... }
    const dto: KycWebhookDto = {
      reference: body.session_id ?? body.reference ?? '',
      status: body.status ?? '',
      externalUserId: body.vendor_data ?? body.external_user_id ?? undefined,
      payload: body,
    };

    return this.kycService.handleProviderWebhook(provider, dto);
  }
}
