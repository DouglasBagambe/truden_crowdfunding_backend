import { IsString, IsUrl, Length } from 'class-validator';
import { ApiProperty } from '../../../common/swagger.decorators';

export class SocialLinkDto {
  @ApiProperty({ description: 'Platform or channel name (e.g., twitter, linkedin)' })
  @IsString()
  @Length(2, 64)
  platform!: string;

  @ApiProperty({ description: 'Profile or page URL' })
  @IsUrl()
  url!: string;
}
