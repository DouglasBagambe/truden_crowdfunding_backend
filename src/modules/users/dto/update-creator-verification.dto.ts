import { IsEnum, IsOptional, IsString, Length } from 'class-validator';
import {
  ApiProperty,
  ApiPropertyOptional,
} from '../../../common/swagger.decorators';
import { CreatorVerificationStatus } from '../../../common/enums/creator-verification-status.enum';

export class UpdateCreatorVerificationDto {
  @ApiProperty({ enum: CreatorVerificationStatus })
  @IsEnum(CreatorVerificationStatus)
  status!: CreatorVerificationStatus;

  @ApiPropertyOptional({ description: 'Reason if rejected' })
  @IsOptional()
  @IsString()
  @Length(0, 500)
  reason?: string;
}
