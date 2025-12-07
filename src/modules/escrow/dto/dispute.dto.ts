import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class DisputeEvidenceDto {
  @IsString()
  @IsNotEmpty()
  uri!: string;

  @IsString()
  @IsNotEmpty()
  type!: string;
}

export class DisputeDto {
  @IsString()
  @IsNotEmpty()
  escrowId!: string;

  @IsString()
  @IsNotEmpty()
  depositId!: string;

  @IsString()
  @IsOptional()
  raisedBy?: string;

  @IsString()
  @IsNotEmpty()
  reason!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DisputeEvidenceDto)
  @IsOptional()
  evidence?: DisputeEvidenceDto[];
}
