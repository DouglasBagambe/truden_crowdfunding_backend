import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { getModelToken } from '@nestjs/mongoose';
import { User, UserDocument } from './src/modules/users/schemas/user.schema';
import { Model } from 'mongoose';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const userModel = app.get<Model<UserDocument>>(getModelToken(User.name));

  const email = 'a@a.com'; 
  const user = await userModel.findOne({ email });

  if (!user) {
    console.log(`User ${email} not found!`);
    await app.close();
    return;
  }

  user.emailVerifiedAt = new Date();
  user.isActive = true;
  user.isBlocked = false;
  
  await user.save();
  console.log(`✅ Successfully verified email for user: ${email}`);
  
  await app.close();
  process.exit(0);
}

bootstrap();
