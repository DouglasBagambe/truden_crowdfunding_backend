import { IsDateString, IsOptional, IsString, Length } from 'class-validator';
import { ApiPropertyOptional } from '../../../common/swagger.decorators';

export class UpdateKycProfileDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 128)
  firstName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 128)
  lastName?: string;

  @ApiPropertyOptional({ description: 'Date of birth', format: 'date' })
  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(2, 64)
  nationality?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(2, 256)
  addressLine1?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 256)
  addressLine2?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(2, 128)
  city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 128)
  stateOrProvince?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 32)
  postalCode?: string;

  @ApiPropertyOptional({ description: 'Country (ISO-3166 alpha 2)' })
  @IsOptional()
  @IsString()
  @Length(2, 4)
  country?: string;

  @ApiPropertyOptional({ description: 'ID document type, e.g. passport, national_id' })
  @IsOptional()
  @IsString()
  @Length(2, 64)
  idType?: string;

  @ApiPropertyOptional({ description: 'Last 4 digits or partial ID number' })
  @IsOptional()
  @IsString()
  @Length(2, 32)
  idNumberLast4?: string;

  @ApiPropertyOptional({ description: 'Country that issued the ID (ISO-3166 alpha 2)' })
  @IsOptional()
  @IsString()
  @Length(2, 4)
  idCountry?: string;

  @ApiPropertyOptional({ description: 'ID expiry date', format: 'date' })
  @IsOptional()
  @IsDateString()
  idExpiryDate?: string;
}
