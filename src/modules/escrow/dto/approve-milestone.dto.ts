import { IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class ApproveMilestoneDto {
  @IsString()
  @IsNotEmpty()
  projectId!: string;

  @IsString()
  @IsNotEmpty()
  milestoneId!: string;

  @IsNumber()
  amount!: number;

  @IsString()
  @IsOptional()
  signature?: string;
}
