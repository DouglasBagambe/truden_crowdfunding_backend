import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '../users/schemas/user.schema';
import { KycController } from './kyc.controller';
import { KycService } from './kyc.service';
import { KycProfile, KycProfileSchema } from './schemas/kyc-profile.schema';
import { DummyKycProviderService } from './providers/dummy-kyc.provider';
import { DiditKycProviderService } from './providers/didit-kyc.provider';
import { LaboremusKycProviderService } from './providers/laboremus-kyc.provider';

@Module({
  imports: [
    ConfigModule,
    MongooseModule.forFeature([
      { name: KycProfile.name, schema: KycProfileSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [KycController],
  providers: [
    KycService,
    DummyKycProviderService,
    DiditKycProviderService,
    LaboremusKycProviderService,
  ],
  exports: [KycService],
})
export class KycModule { }
