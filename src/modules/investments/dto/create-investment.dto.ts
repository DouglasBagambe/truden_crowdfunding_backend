import { IsNotEmpty, IsNumberString, IsOptional, IsString } from 'class-validator';

export class CreateInvestmentDto {
  @IsString()
  @IsNotEmpty()
  projectId!: string;

  @IsNumberString()
  amount!: string;

  @IsString()
  @IsOptional()
  projectOnchainId?: string;
}
