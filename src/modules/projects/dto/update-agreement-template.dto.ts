import { PartialType } from '@nestjs/swagger';
import { CreateAgreementTemplateDto } from './create-agreement-template.dto';
import { ApiPropertyOptional } from '../../../common/swagger.decorators';
import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateAgreementTemplateDto extends PartialType(
  CreateAgreementTemplateDto,
) {
  @ApiPropertyOptional({ description: 'Incremented automatically on content changes' })
  @IsOptional()
  @IsBoolean()
  bumpVersion?: boolean;
}
