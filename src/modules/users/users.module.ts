import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from './schemas/user.schema';
import { UsersController } from './controllers/users.controller';
import { KycWebhookController } from './controllers/kyc-webhook.controller';
import { UsersService } from './users.service';
import { UsersRepository } from './repositories/users.repository';
import { UserEventsListener } from './listeners/user-events.listener';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { HttpModule } from '@nestjs/axios';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
    HttpModule,
    AuthModule,
    AuditModule,
  ],
  controllers: [UsersController, KycWebhookController],
  providers: [
    UsersService,
    UsersRepository,
    UserEventsListener,
  ],
  exports: [UsersService, UsersRepository],
})
export class UsersModule {}
