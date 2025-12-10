import {
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';
import {
  ApiProperty,
  ApiPropertyOptional,
} from '../../../common/swagger.decorators';
import { IsUrl } from 'class-validator';

class HomeAddressDto {
  @ApiProperty({ description: 'Street address line 1' })
  @IsString()
  @Length(2, 200)
  line1!: string;

  @ApiPropertyOptional({ description: 'Street address line 2' })
  @IsOptional()
  @IsString()
  @Length(0, 200)
  line2?: string;

  @ApiProperty({ description: 'City' })
  @IsString()
  @Length(2, 128)
  city!: string;

  @ApiPropertyOptional({ description: 'State/Province/Region' })
  @IsOptional()
  @IsString()
  @Length(0, 128)
  state?: string;

  @ApiProperty({ description: 'Postal/ZIP code' })
  @IsString()
  @Length(2, 32)
  postalCode!: string;

  @ApiProperty({ description: 'Country code (ISO-3166 alpha 2)' })
  @IsString()
  @Length(2, 4)
  country!: string;
}

class KycAttachmentDto {
  @ApiProperty({ description: 'Attachment title' })
  @IsString()
  @Length(2, 128)
  title!: string;

  @ApiProperty({ description: 'Attachment URL' })
  @IsUrl()
  url!: string;

  @ApiPropertyOptional({ description: 'Attachment type/label' })
  @IsOptional()
  @IsString()
  @Length(0, 64)
  type?: string;

  @ApiPropertyOptional({
    description: 'Required for verification',
    default: false,
  })
  @IsOptional()
  isRequired?: boolean;
}

export class SubmitKycDto {
  @ApiProperty({ description: 'Document type (e.g., passport, national_id)' })
  @IsString()
  @Length(2, 64)
  documentType!: string;

  @ApiProperty({ description: 'Document country (ISO-3166 alpha 2)' })
  @IsString()
  @Length(2, 4)
  documentCountry!: string;

  @ApiPropertyOptional({
    description: 'Last 4 of document number (hashed if needed)',
  })
  @IsOptional()
  @IsString()
  @Length(2, 16)
  documentLast4?: string;

  @ApiProperty({ description: 'Date of birth', format: 'date' })
  @IsDateString()
  dateOfBirth!: string;

  @ApiProperty({ description: 'Home address for KYC screening', type: HomeAddressDto })
  homeAddress!: HomeAddressDto;

  @ApiPropertyOptional({
    description: 'Attachments metadata (if you manage uploads separately)',
    type: [KycAttachmentDto],
  })
  @IsOptional()
  @IsArray()
  attachments?: KycAttachmentDto[];
}
