import { IsOptional, IsString, Length } from 'class-validator';

export class CreateKycSessionDto {
  @IsOptional()
  @IsString()
  @Length(2, 64)
  documentType?: string;

  @IsOptional()
  @IsString()
  @Length(2, 4)
  documentCountry?: string;
}
