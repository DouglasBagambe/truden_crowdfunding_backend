import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class RevokeAccessDto {
  @IsString()
  @IsNotEmpty()
  documentId!: string;

  @IsString()
  @IsOptional()
  granteeUserId?: string;

  @IsBoolean()
  @IsOptional()
  revokeAll?: boolean;

  @IsString()
  @IsOptional()
  reason?: string;
}
