import { IsNotEmpty, IsNumberString, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateCharityDonationDto {
  @IsString()
  @IsNotEmpty()
  projectId!: string;

  @IsNumberString()
  amount!: string;

  @IsString()
  @IsOptional()
  @MaxLength(80)
  donorName?: string;

  @IsString()
  @IsOptional()
  @MaxLength(280)
  message?: string;
}
