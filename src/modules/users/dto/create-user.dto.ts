import {
  IsArray,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  Length,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { BadRequestException } from '@nestjs/common';
import { KYCStatus, UserRole } from '../../../common/enums/role.enum';
import {
  ApiProperty,
  ApiPropertyOptional,
} from '../../../common/swagger.decorators';
import { CreatorVerificationStatus } from '../../../common/enums/creator-verification-status.enum';

const toLowerCase = (value: unknown) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

const normalizeWalletArray = (value: unknown): string[] | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new BadRequestException(
      'linkedWallets must be an array of wallet strings',
    );
  }
  const wallets = value
    .filter(
      (wallet): wallet is string =>
        typeof wallet === 'string' && wallet.trim().length > 0,
    )
    .map((wallet) => wallet.trim().toLowerCase());

  return wallets;
};

export class CreateUserDto {
  @ApiProperty({
    description: 'Primary wallet address used for SIWE authentication',
  })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (value ? toLowerCase(value) : value))
  primaryWallet?: string;

  @ApiProperty({
    description: 'Display name visible on the platform',
    minLength: 2,
    maxLength: 64,
  })
  @IsString()
  @Length(2, 64)
  displayName!: string;
  displayName!: string;

  @ApiProperty({ description: 'Contact email for notifications' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({
    description: 'Password for email-based login (optional if using OAuth)',
  })
  @IsOptional()
  @IsString()
  @Length(8, 128)
  password?: string;

  @ApiPropertyOptional({ description: 'Avatar URL', format: 'uri' })
  @IsOptional()
  @IsUrl()
  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value))
  avatarUrl?: string;

  @ApiPropertyOptional({ description: 'Avatar image as base64 (data URL or raw base64)' })
  @IsOptional()
  @IsString()
  avatarBase64?: string;

  @ApiPropertyOptional({ description: 'Country code (ISO-3166 alpha 2)' })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiPropertyOptional({ description: 'Residency country (ISO-3166 alpha 2)' })
  @IsOptional()
  @IsString()
  residencyCountry?: string;

  @ApiPropertyOptional({ enum: UserRole, default: UserRole.INVESTOR })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional({ enum: KYCStatus, default: KYCStatus.NOT_VERIFIED })
  @IsOptional()
  @IsEnum(KYCStatus)
  kycStatus?: KYCStatus;

  @ApiPropertyOptional({
    enum: CreatorVerificationStatus,
    default: CreatorVerificationStatus.NOT_SUBMITTED,
  })
  @IsOptional()
  @IsEnum(CreatorVerificationStatus)
  creatorVerificationStatus?: CreatorVerificationStatus;

  @ApiPropertyOptional({
    description: 'Additional wallets controlled by the user',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => normalizeWalletArray(value))
  linkedWallets?: string[];
}
