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
import { CustodialWalletService } from './services/custodial-wallet.service';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { HttpModule } from '@nestjs/axios';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
    ConfigModule,
    HttpModule,
    AuthModule,
    AuditModule,
  ],
  controllers: [UsersController, AdminUsersController, KycWebhookController],
  providers: [
    UsersService,
    UsersRepository,
    UserEventsListener,
    CustodialWalletService,
  ],
  exports: [UsersService, UsersRepository, CustodialWalletService],
})
export class UsersModule { }
