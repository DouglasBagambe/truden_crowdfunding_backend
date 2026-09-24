import { IsMongoId } from 'class-validator';

/**
 * The release amount and recipient are deliberately absent: both are derived
 * from approved campaign state and the PostgreSQL financial ledger.
 */
export class ReleaseCharityMilestoneDto {
  @IsMongoId()
  projectId!: string;

  @IsMongoId()
  milestoneId!: string;
}
