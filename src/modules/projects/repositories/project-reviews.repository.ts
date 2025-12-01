import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ProjectReview, ProjectReviewDocument } from '../schemas/project-review.schema';

@Injectable()
export class ProjectReviewsRepository {
  constructor(
    @InjectModel(ProjectReview.name)
    private readonly reviewModel: Model<ProjectReviewDocument>,
  ) {}

  create(payload: Partial<ProjectReview>): Promise<ProjectReviewDocument> {
    return this.reviewModel.create(payload);
  }

  findByProject(projectId: string): Promise<ProjectReviewDocument[]> {
    return this.reviewModel.find({ projectId }).sort({ createdAt: -1 }).exec();
  }

  findExisting(projectId: string, reviewerId: string) {
    return this.reviewModel.findOne({ projectId, reviewerId }).exec();
  }
}
