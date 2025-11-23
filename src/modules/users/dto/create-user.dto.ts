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
import { KycStatus, UserRole } from '../schemas/user.schema';
import {
  ApiProperty,
  ApiPropertyOptional,
} from '../../../common/swagger.decorators';

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
  @IsString()
  @Transform(({ value }) => toLowerCase(value))
  primaryWallet!: string;

  @ApiProperty({
    description: 'Display name visible on the platform',
    minLength: 2,
    maxLength: 64,
  })
  @IsString()
  @Length(2, 64)
  displayName!: string;

  @ApiProperty({ description: 'Contact email for notifications' })
  @IsEmail()
  email!: string;

  @ApiPropertyOptional({ description: 'Avatar URL', format: 'uri' })
  @IsOptional()
  @IsUrl()
  avatarUrl?: string;

  @ApiPropertyOptional({ description: 'Country code (ISO-3166 alpha 2)' })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiPropertyOptional({ enum: UserRole, default: UserRole.User })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional({ enum: KycStatus, default: KycStatus.None })
  @IsOptional()
  @IsEnum(KycStatus)
  kycStatus?: KycStatus;

  @ApiPropertyOptional({
    description: 'Additional wallets controlled by the user',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => normalizeWalletArray(value))
  linkedWallets?: string[];
}
