import { IsEnum } from 'class-validator';
import { KycStatus } from '../schemas/user.schema';
import { ApiProperty } from '../../common/swagger.decorators';

export class UpdateKycStatusDto {
  @ApiProperty({ enum: KycStatus })
  @IsEnum(KycStatus)
  kycStatus: KycStatus;
}
