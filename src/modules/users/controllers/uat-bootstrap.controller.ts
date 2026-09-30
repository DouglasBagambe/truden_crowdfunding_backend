import {
  Body,
  Controller,
  Headers,
  HttpException,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { timingSafeEqual } from 'crypto';
import { Model } from 'mongoose';
import { Public } from '../../../common/decorators/public.decorator';
import { CreatorVerificationStatus } from '../../../common/enums/creator-verification-status.enum';
import { KYCStatus, UserRole } from '../../../common/enums/role.enum';
import { User, UserDocument } from '../schemas/user.schema';

@Controller('uat')
export class UatBootstrapController {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly configService: ConfigService,
  ) {}

  @Public()
  @Post('bootstrap-admin')
  async bootstrapAdmin(
    @Body('email') emailValue: unknown,
    @Headers('x-uat-bootstrap-secret') suppliedSecret: string | undefined,
  ) {
    if (this.configService.get<string>('NODE_ENV') !== 'test') {
      throw new HttpException('Not found', HttpStatus.NOT_FOUND);
    }

    const expectedSecret = this.configService.get<string>(
      'UAT_BOOTSTRAP_SECRET',
    );
    if (
      !expectedSecret ||
      !suppliedSecret ||
      !this.secretsMatch(suppliedSecret, expectedSecret)
    ) {
      throw new HttpException(
        'Bootstrap unavailable',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    if (typeof emailValue !== 'string' || !emailValue.trim()) {
      throw new HttpException('Email is required', HttpStatus.BAD_REQUEST);
    }
    const email = emailValue.trim().toLowerCase();
    const user = await this.userModel
      .findOne({ email })
      .select('+passwordHash');
    if (!user) throw new HttpException('User not found', HttpStatus.NOT_FOUND);

    const now = new Date();
    user.roles = Array.from(
      new Set([...(user.roles || []), UserRole.ADMIN, UserRole.SUPERADMIN]),
    );
    user.isActive = true;
    user.isBlocked = false;
    user.emailVerifiedAt = now;
    user.emailVerificationCodeHash = undefined;
    user.emailVerificationCodeExpiresAt = undefined;
    user.emailVerificationAttempts = 0;
    user.emailVerificationBlockedUntil = undefined;
    user.kycStatus = KYCStatus.VERIFIED;
    user.kyc = {
      ...(user.kyc || {}),
      status: KYCStatus.VERIFIED,
      providerStatus: 'VERIFIED',
      verifiedAt: now,
    };
    user.creatorVerification = {
      ...(user.creatorVerification || {}),
      status: CreatorVerificationStatus.VERIFIED,
      verifiedAt: now,
    };
    await user.save();

    return {
      success: true,
      email,
      roles: user.roles,
      emailVerified: true,
      kycStatus: user.kycStatus,
      creatorVerificationStatus: user.creatorVerification.status,
    };
  }

  private secretsMatch(supplied: string, expected: string): boolean {
    const suppliedBuffer = Buffer.from(supplied);
    const expectedBuffer = Buffer.from(expected);
    return (
      suppliedBuffer.length === expectedBuffer.length &&
      timingSafeEqual(suppliedBuffer, expectedBuffer)
    );
  }
}
