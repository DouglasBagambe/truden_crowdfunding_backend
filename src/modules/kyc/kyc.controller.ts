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
import { createHash } from 'crypto';
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
import { CsrfExempt } from '../../common/decorators/csrf-exempt.decorator';
import { verifyDiditWebhook } from './didit-webhook.util';

function webhookString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

@ApiTags('kyc')
@ApiBearerAuth()
@Controller('kyc')
export class KycController {
  constructor(
    private readonly kycService: KycService,
    private readonly configService: ConfigService,
  ) {}

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
    @CurrentUser('sub') actorId: string,
    @CurrentUser('roles') actorRoles: string[],
  ) {
    return this.kycService.adminOverrideStatus(id, dto, actorId, actorRoles);
  }

  @Post('admin/profiles/:id/sync')
  @RoleMetadataOr(UserRole.ADMIN)
  @Permissions(Permission.MANAGE_USERS)
  adminSyncFromProvider(
    @Param('id') id: string,
    @CurrentUser('sub') actorId: string,
    @CurrentUser('roles') actorRoles: string[],
  ) {
    return this.kycService.syncStatusFromProvider(id, actorId, actorRoles);
  }

  @Public()
  @CsrfExempt()
  @Post('webhook/:provider')
  providerWebhook(
    @Param('provider') provider: string,
    @Body() body: Record<string, any>,
    @Req() req: Request,
    @Headers('x-signature-v2') sigV2?: string,
    @Headers('x-signature') sigV1?: string,
    @Headers('x-signature-simple') sigSimple?: string,
    @Headers('x-timestamp') timestampHeader?: string,
  ) {
    if (provider !== 'didit') {
      throw new ForbiddenException('Unsupported KYC webhook provider');
    }
    const webhookSecret = this.configService.get<string>(
      'DIDIT_WEBHOOK_SECRET',
    );

    if (provider === 'didit' && !webhookSecret) {
      throw new ForbiddenException('Didit webhook secret is not configured');
    }

    if (provider === 'didit' && webhookSecret) {
      if (!sigV2 && !sigV1 && !sigSimple) {
        throw new ForbiddenException('Missing webhook signature');
      }

      const rawValue = (req as Request & { rawBody?: Buffer }).rawBody;
      const verification = verifyDiditWebhook({
        body,
        rawBody: rawValue,
        signatureV2: sigV2,
        signatureV1: sigV1,
        signatureSimple: sigSimple,
        timestamp: timestampHeader,
        secret: webhookSecret,
      });

      const dto: KycWebhookDto = {
        reference: webhookString(body.session_id ?? body.reference) ?? '',
        status: webhookString(body.status) ?? '',
        externalUserId: webhookString(
          body.vendor_data ?? body.external_user_id,
        ),
        payload: body,
      };

      return this.kycService.handleProviderWebhook(provider, dto, {
        eventKey: createHash('sha256')
          .update(verification.canonicalBody)
          .digest('hex'),
        eventAt: verification.eventAt,
      });
    }
    throw new ForbiddenException('KYC webhook verification is unavailable');
  }
}
