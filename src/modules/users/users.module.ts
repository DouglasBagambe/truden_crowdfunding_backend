import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from './schemas/user.schema';
import { UsersController } from './controllers/users.controller';
import { UsersService } from './users.service';
import { UsersRepository } from './repositories/users.repository';
import { UserEventsListener } from './listeners/user-events.listener';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
  ],
  controllers: [UsersController],
  providers: [
    UsersService,
    UsersRepository,
    UserEventsListener,
  ],
  exports: [UsersService, UsersRepository],
})
export class UsersModule {}
