import { Transform } from 'class-transformer';
import { IsDate, IsOptional, IsString, Length } from 'class-validator';
import {
  ApiProperty,
  ApiPropertyOptional,
} from '../../../common/swagger.decorators';

const toDate = (value: unknown) =>
  value ? new Date(value as string) : undefined;

export class MilestoneDto {
  @ApiProperty({ description: 'Milestone title' })
  @IsString()
  @Length(2, 128)
  title!: string;

  @ApiProperty({ description: 'Milestone description' })
  @IsString()
  @Length(4, 2000)
  description!: string;

  @ApiPropertyOptional({ description: 'Optional milestone due date' })
  @IsOptional()
  @IsDate()
  @Transform(({ value }) => toDate(value))
  dueDate?: Date;

  @ApiPropertyOptional({
    description:
      'Optional payout percentage (not required for all-or-nothing funding)',
    minimum: 0,
    maximum: 100,
    default: 0,
  })
  @IsOptional()
  payoutPercentage?: number = 0;

  @ApiPropertyOptional({
    description: 'Evidence links (IPFS URLs, attachments)',
    type: [String],
  })
  @IsOptional()
  proofLinks?: string[];
}
