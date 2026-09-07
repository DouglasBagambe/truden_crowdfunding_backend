import { IsString, IsEthereumAddress, IsIn, IsOptional } from 'class-validator';

export class SiweNonceDto {
  @IsEthereumAddress()
  address!: string;

  @IsOptional()
  @IsIn(['link', 'unlink'])
  purpose?: 'link' | 'unlink';
}

export class SiweVerifyDto {
  @IsString()
  message!: string;

  @IsString()
  signature!: string;
}
