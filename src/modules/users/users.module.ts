import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { User, UserSchema } from './schemas/user.schema';
import { UsersController } from './controllers/users.controller';
import { AdminUsersController } from './controllers/admin-users.controller';
import { KycWebhookController } from './controllers/kyc-webhook.controller';
import { UsersService } from './users.service';
import { UsersRepository } from './repositories/users.repository';
import { UserEventsListener } from './listeners/user-events.listener';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { HttpModule } from '@nestjs/axios';
import {
  WalletOwnership,
  WalletOwnershipSchema,
} from './schemas/wallet-ownership.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: WalletOwnership.name, schema: WalletOwnershipSchema },
    ]),
    ConfigModule,
    HttpModule,
    AuthModule,
    AuditModule,
  ],
  controllers: [UsersController, AdminUsersController, KycWebhookController],
  providers: [UsersService, UsersRepository, UserEventsListener],
  exports: [UsersService, UsersRepository],
})
export class UsersModule {}
