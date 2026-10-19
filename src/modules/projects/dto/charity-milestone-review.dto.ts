import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsString,
  IsUrl,
  Length,
} from 'class-validator';

export class SubmitCharityMilestoneDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsUrl({ protocols: ['https'], require_protocol: true }, { each: true })
  proofLinks!: string[];
}
export class ReviewCharityMilestoneDto {
  @IsIn(['APPROVED', 'REJECTED']) decision!: 'APPROVED' | 'REJECTED';
  @IsString() @Length(10, 2000) reason!: string;
}
