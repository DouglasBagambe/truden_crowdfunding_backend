import { IsOptional, IsString } from 'class-validator';
import { Transform } from 'class-transformer';
import { BadRequestException } from '@nestjs/common';
import { ApiProperty } from '../../../common/swagger.decorators';

const normalizeWallet = (value: unknown) => {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      throw new BadRequestException('Wallet address cannot be empty');
    }
    if (!/^0x[a-f0-9]{40}$/.test(normalized)) {
      throw new BadRequestException('Wallet address must be a valid EVM address');
    }
    return normalized;
  }
  throw new BadRequestException('Wallet address must be a string');
};

export class LinkWalletDto {
  @ApiProperty({ description: 'Wallet address to link/unlink' })
  @IsString()
  @Transform(({ value }) => normalizeWallet(value))
  wallet!: string;

  @ApiProperty({ description: 'SIWE message used to prove wallet ownership', required: false })
  @IsOptional()
  @IsString()
  message?: string;

  @ApiProperty({ description: 'SIWE signature for the wallet-link message', required: false })
  @IsOptional()
  @IsString()
  signature?: string;
}
