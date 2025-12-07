import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class RefundDto {
  @IsString()
  @IsNotEmpty()
  depositId!: string;

  @IsString()
  @IsNotEmpty()
  reason!: string;

  @IsString()
  @IsOptional()
  initiatedBy?: string;
}
