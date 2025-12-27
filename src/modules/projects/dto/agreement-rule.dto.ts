import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';
import {
  ApiProperty,
  ApiPropertyOptional,
} from '../../../common/swagger.decorators';

export class AgreementRuleDto {
  @ApiProperty({ description: 'Rule title or short agreement label' })
  @IsString()
  @Length(2, 200)
  title!: string;

  @ApiPropertyOptional({ description: 'Details for the agreement or rule' })
  @IsOptional()
  @IsString()
  @Length(0, 2000)
  description?: string;

  @ApiProperty({
    description:
      'Indicates if investors must accept this rule/agreement before contributing',
    default: true,
  })
  @IsBoolean()
  requiresAcceptance: boolean = true;

  @ApiPropertyOptional({
    description: 'Source agreement template id (internal)',
  })
  @IsOptional()
  @IsString()
  templateId?: string;

  @ApiPropertyOptional({
    description: 'Version of the template when applied',
  })
  @IsOptional()
  templateVersion?: number;
}
