import { PartialType } from '@nestjs/swagger';
import { CreateAttachmentRequirementDto } from './create-attachment-requirement.dto';
import { ApiPropertyOptional } from '../../../common/swagger.decorators';
import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateAttachmentRequirementDto extends PartialType(
  CreateAttachmentRequirementDto,
) {
  @ApiPropertyOptional({ description: 'Increment version' })
  @IsOptional()
  @IsBoolean()
  bumpVersion?: boolean;
}
