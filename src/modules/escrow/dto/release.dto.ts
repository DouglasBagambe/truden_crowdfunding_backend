import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class ReleaseDto {
  @IsString()
  @IsNotEmpty()
  projectId!: string;

  @IsString()
  @IsNotEmpty()
  milestoneId!: string;

  @IsString()
  @IsOptional()
  requestedBy?: string;

  @IsString()
  @IsOptional()
  approvalSignature?: string;
}
