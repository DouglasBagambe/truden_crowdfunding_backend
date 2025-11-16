import { IsString } from 'class-validator';
import { Transform } from 'class-transformer';
import { BadRequestException } from '@nestjs/common';
import { ApiProperty } from '../../common/swagger.decorators';

const normalizeWallet = (value: unknown) => {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      throw new BadRequestException('Wallet address cannot be empty');
    }
    return normalized;
  }
  throw new BadRequestException('Wallet address must be a string');
};

export class LinkWalletDto {
  @ApiProperty({ description: 'Wallet address to link/unlink' })
  @IsString()
  @Transform(({ value }) => normalizeWallet(value))
  wallet: string;
}
