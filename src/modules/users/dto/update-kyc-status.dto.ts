import { IsEnum } from 'class-validator';
import { KYCStatus } from '../../../common/enums/role.enum';
import { ApiProperty } from '../../../common/swagger.decorators';

export class UpdateKycStatusDto {
  @ApiProperty({ enum: KYCStatus })
  @IsEnum(KYCStatus)
  kycStatus!: KYCStatus;
}
