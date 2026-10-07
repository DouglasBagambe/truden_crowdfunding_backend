import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  SavedProject,
  SavedProjectDocument,
} from '../schemas/saved-project.schema';
import { ProjectsService } from '../projects.service';
@Injectable()
export class SavedProjectsService {
  constructor(
    @InjectModel(SavedProject.name)
    private readonly saved: Model<SavedProjectDocument>,
    private readonly projects: ProjectsService,
  ) {}
  private key(userId: string, projectId: string) {
    if (!Types.ObjectId.isValid(projectId))
      throw new NotFoundException('Project not found');
    return {
      userId: new Types.ObjectId(userId),
      projectId: new Types.ObjectId(projectId),
    };
  }
  async get(userId: string, projectId: string) {
    await this.projects.getProjectPublic(projectId, userId);
    return {
      saved: Boolean(await this.saved.exists(this.key(userId, projectId))),
    };
  }
  async set(userId: string, projectId: string, saved: boolean) {
    await this.projects.getProjectPublic(projectId, userId);
    const key = this.key(userId, projectId);
    if (saved)
      await this.saved.updateOne(key, { $setOnInsert: key }, { upsert: true });
    else await this.saved.deleteOne(key);
    return { saved };
  }
}
