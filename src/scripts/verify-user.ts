import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { getModelToken } from '@nestjs/mongoose';
import { User, UserDocument } from '../modules/users/schemas/user.schema';
import { Model } from 'mongoose';
import { KYCStatus, UserRole } from '../common/enums/role.enum';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const userModel = app.get<Model<UserDocument>>(getModelToken(User.name));

  const email = 'test@example.com'; 
  const user = await userModel.findOne({ email });

  if (!user) {
    console.log(`User ${email} not found!`);
    await app.close();
    return;
  }

  user.emailVerifiedAt = new Date();
  user.isActive = true;
  user.isBlocked = false;
  user.kycStatus = KYCStatus.VERIFIED;
  user.roles = [UserRole.INVESTOR, UserRole.INNOVATOR];
  user.primaryWallet = '0x742d35Cc6634C0532925a3b844Bc454e4438f44e'; // Dummy wallet

  
  await user.save();
  console.log(`✅ Successfully verified email and KYC for user: ${email}`);
  
  await app.close();
  process.exit(0);
}

bootstrap();
