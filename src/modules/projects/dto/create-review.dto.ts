import { IsEnum, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '../../../common/swagger.decorators';
import { ReviewRecommendation } from '../schemas/project-review.schema';

export class CreateReviewDto {
  @ApiProperty({ description: 'Score for the project (1-5)' })
  @IsNumber()
  @Min(1)
  @Max(5)
  score!: number;

  @ApiPropertyOptional({ description: 'Reviewer comments' })
  @IsOptional()
  @IsString()
  comments?: string;

  @ApiProperty({ enum: ReviewRecommendation, description: 'Recommendation' })
  @IsEnum(ReviewRecommendation)
  recommendation!: ReviewRecommendation;
}
