import { IsEnum, IsOptional, IsString } from 'class-validator';
import {
  ApiProperty,
  ApiPropertyOptional,
} from '../../../common/swagger.decorators';
import { ProjectStatus } from '../../../common/enums/project-status.enum';

export class ProjectDecisionDto {
  @ApiProperty({
    enum: ProjectStatus,
    description:
      'Final decision status (APPROVED, REJECTED, or CHANGES_REQUESTED)',
  })
  @IsEnum(ProjectStatus)
  finalStatus!: ProjectStatus;

  @ApiPropertyOptional({ description: 'Reason for the decision' })
  @IsOptional()
  @IsString()
  reason?: string;
}
