import { IsString, IsEthereumAddress } from 'class-validator';

export class SiweNonceDto {
  @IsEthereumAddress()
  address!: string;
}

export class SiweVerifyDto {
  @IsString()
  message!: string;

  @IsString()
  signature!: string;
}
