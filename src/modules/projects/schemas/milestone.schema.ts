import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { MilestoneStatus } from '../../../common/enums/milestone-status.enum';

export type MilestoneDocument = HydratedDocument<Milestone>;

@Schema({
  collection: 'milestones',
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
})
export class Milestone {
  @Prop({ required: true, index: true })
  projectId!: string;

  @Prop({ required: true, trim: true })
  title!: string;

  @Prop({ required: true, trim: true })
  description!: string;

  @Prop({ type: Date })
  dueDate?: Date;

  @Prop({ min: 0, max: 100, default: 0 })
  payoutPercentage?: number;

  @Prop({
    type: String,
    enum: MilestoneStatus,
    default: MilestoneStatus.PLANNED,
  })
  status!: MilestoneStatus;

  @Prop({ type: [String], default: [] })
  proofLinks!: string[];

  @Prop({ type: Date })
  createdAt?: Date;

  @Prop({ type: Date })
  updatedAt?: Date;
}

export const MilestoneSchema = SchemaFactory.createForClass(Milestone);

MilestoneSchema.index({ projectId: 1, status: 1 });
