import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional } from 'class-validator';

export class TrendsQueryDto {
  @ApiPropertyOptional({
    description: 'ISO date (inclusive) for start of range',
    example: '2024-01-01T00:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({
    description: 'ISO date (exclusive) for end of range',
    example: '2024-02-01T00:00:00.000Z',
  })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiPropertyOptional({
    description: 'Bucket size for trends',
    enum: ['day', 'week'],
    default: 'day',
  })
  @IsOptional()
  @IsIn(['day', 'week'])
  interval?: 'day' | 'week';
}
