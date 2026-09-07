import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '../users/schemas/user.schema';
import { KycController } from './kyc.controller';
import { KycService } from './kyc.service';
import { KycProfile, KycProfileSchema } from './schemas/kyc-profile.schema';
import { DummyKycProviderService } from './providers/dummy-kyc.provider';
import { DiditKycProviderService } from './providers/didit-kyc.provider';
import {
  KycWebhookEvent,
  KycWebhookEventSchema,
} from './schemas/kyc-webhook-event.schema';
import { AuditModule } from '../audit/audit.module';
// NOTE: LaboremusKycProviderService removed — Didit handles all KYC for now.
// Re-add when KYB (business verification) is needed.

@Module({
  imports: [
    ConfigModule,
    AuditModule,
    MongooseModule.forFeature([
      { name: KycProfile.name, schema: KycProfileSchema },
      { name: User.name, schema: UserSchema },
      { name: KycWebhookEvent.name, schema: KycWebhookEventSchema },
    ]),
  ],
  controllers: [KycController],
  providers: [KycService, DummyKycProviderService, DiditKycProviderService],
  exports: [KycService],
})
export class KycModule {}
