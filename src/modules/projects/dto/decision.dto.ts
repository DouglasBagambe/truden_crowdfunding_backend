import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '../../../common/swagger.decorators';
import { ProjectStatus } from '../../../common/enums/project-status.enum';

export class ProjectDecisionDto {
  @ApiProperty({
    enum: ProjectStatus,
    description: 'Final decision status (APPROVED or REJECTED)',
  })
  @IsEnum(ProjectStatus)
  finalStatus!: ProjectStatus;

  @ApiPropertyOptional({ description: 'Reason for the decision' })
  @IsOptional()
  @IsString()
  reason?: string;
}
