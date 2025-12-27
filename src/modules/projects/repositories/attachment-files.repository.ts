import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ProjectAttachmentFile,
  ProjectAttachmentFileDocument,
} from '../schemas/attachment-file.schema';

@Injectable()
export class AttachmentFilesRepository {
  constructor(
    @InjectModel(ProjectAttachmentFile.name)
    private readonly fileModel: Model<ProjectAttachmentFileDocument>,
  ) {}

  create(payload: Partial<ProjectAttachmentFile>) {
    return this.fileModel.create(payload);
  }

  findById(id: string) {
    return this.fileModel.findById(id).exec();
  }

  deleteById(id: string) {
    return this.fileModel.findByIdAndDelete(id).exec();
  }
}
