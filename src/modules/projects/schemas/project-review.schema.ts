import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type ProjectReviewDocument = HydratedDocument<ProjectReview>;

export enum ReviewRecommendation {
  APPROVE = 'APPROVE',
  REJECT = 'REJECT',
}

@Schema({
  collection: 'projectReviews',
  timestamps: { createdAt: 'createdAt', updatedAt: false },
})
export class ProjectReview {
  @Prop({ required: true, index: true })
  projectId!: string;

  @Prop({ required: true, index: true })
  reviewerId!: string;

  @Prop({ required: true, min: 1, max: 5 })
  score!: number;

  @Prop({ trim: true })
  comments?: string;

  @Prop({ type: String, enum: ReviewRecommendation, required: true })
  recommendation!: ReviewRecommendation;

  @Prop({ type: Date })
  createdAt?: Date;
}

export const ProjectReviewSchema = SchemaFactory.createForClass(ProjectReview);

ProjectReviewSchema.index({ projectId: 1, reviewerId: 1 }, { unique: true });
