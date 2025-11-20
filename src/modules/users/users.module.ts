import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from './schemas/user.schema';
import { UsersController } from './controllers/users.controller';
import { UsersService } from './users.service';
import { UsersRepository } from './repositories/users.repository';
import { UserEventsListener } from './listeners/user-events.listener';
import { RolesGuard } from './guards/roles.guard';
import { JwtSiweAuthGuard } from './guards/jwt-siwe.guard';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
  ],
  controllers: [UsersController],
  providers: [
    UsersService,
    UsersRepository,
    UserEventsListener,
    RolesGuard,
    JwtSiweAuthGuard,
  ],
  exports: [UsersService, UsersRepository],
})
export class UsersModule {}
