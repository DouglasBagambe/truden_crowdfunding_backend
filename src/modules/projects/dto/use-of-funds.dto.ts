import { IsNumber, IsOptional, IsString, Min, Length } from 'class-validator';
import { ApiPropertyOptional } from '../../../common/swagger.decorators';

export class UseOfFundsDto {
  @ApiPropertyOptional({
    description: 'Category of spend (e.g., marketing, production)',
  })
  @IsOptional()
  @IsString()
  @Length(2, 128)
  item?: string;

  @ApiPropertyOptional({ description: 'Narrative description of the spend' })
  @IsOptional()
  @IsString()
  @Length(0, 500)
  description?: string;

  @ApiPropertyOptional({ description: 'Amount allocated to this item' })
  @IsOptional()
  @IsNumber()
  @Min(0)
  amount?: number;

  @ApiPropertyOptional({
    description: 'Percentage of target allocated to this item',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  percentage?: number;
}
