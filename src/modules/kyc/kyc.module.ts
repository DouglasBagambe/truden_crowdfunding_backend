import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '../users/schemas/user.schema';
import { KycController } from './kyc.controller';
import { KycService } from './kyc.service';
import { KycProfile, KycProfileSchema } from './schemas/kyc-profile.schema';
import { DummyKycProviderService } from './providers/dummy-kyc.provider';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: KycProfile.name, schema: KycProfileSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [KycController],
  providers: [KycService, DummyKycProviderService],
  exports: [KycService],
})
export class KycModule {}
