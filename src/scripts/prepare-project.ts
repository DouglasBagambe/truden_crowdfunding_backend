import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { getModelToken } from '@nestjs/mongoose';
import { Project, ProjectDocument } from '../modules/projects/schemas/project.schema';
import { Model } from 'mongoose';
import { ProjectStatus } from '../common/enums/project-status.enum';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  // @ts-ignore
  const projectModel = app.get<Model<ProjectDocument>>(getModelToken(Project.name));

  const projectId = '697265d7a5d2c76ecb77b23c';
  const project = await projectModel.findById(projectId);

  if (!project) {
    console.log(`❌ Project ${projectId} not found!`);
    await app.close();
    return;
  }

  // FORCE PROJECT STATE TO BE READY FOR INVESTMENT
  project.status = ProjectStatus.FUNDING;
  project.fundingStartDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // Started yesterday
  project.fundingEndDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // Ends in 30 days
  project.targetAmount = 1000;
  
  await project.save();
  console.log(`✅ Project ${projectId} updated successfully!`);
  console.log(`   - Status: FUNDING`);
  console.log(`   - Start Date: ${project.fundingStartDate}`);
  console.log(`   - End Date: ${project.fundingEndDate}`);
  console.log(`🚀 YOU CAN NOW INVEST!`);

  await app.close();
  process.exit(0);
}

bootstrap();
