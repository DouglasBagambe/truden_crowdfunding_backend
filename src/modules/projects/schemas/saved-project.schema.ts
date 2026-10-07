import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
@Schema({ timestamps: true })
export class SavedProject {
  @Prop({ type: Types.ObjectId, required: true }) userId!: Types.ObjectId;
  @Prop({ type: Types.ObjectId, required: true }) projectId!: Types.ObjectId;
}
export type SavedProjectDocument = HydratedDocument<SavedProject>;
export const SavedProjectSchema = SchemaFactory.createForClass(SavedProject);
SavedProjectSchema.index({ userId: 1, projectId: 1 }, { unique: true });
