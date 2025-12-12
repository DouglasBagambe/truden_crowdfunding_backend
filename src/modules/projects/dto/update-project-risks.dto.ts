import { ApiPropertyOptional } from '../../../common/swagger.decorators';
import { IsOptional, IsString, Length } from 'class-validator';

export class UpdateProjectRisksDto {
  @ApiPropertyOptional({ description: 'Risks (for ROI) or challenges (for charity)' })
  @IsOptional()
  @IsString()
  @Length(0, 4000)
  risksOrChallenges?: string;
}
