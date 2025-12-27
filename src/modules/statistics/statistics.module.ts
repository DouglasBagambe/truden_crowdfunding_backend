import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { StatisticsService } from './statistics.service';
import { PublicStatisticsController } from './controllers/public-statistics.controller';
import { UserStatisticsController } from './controllers/user-statistics.controller';
import { AdminStatisticsController } from './controllers/admin-statistics.controller';
import { Project, ProjectSchema } from '../projects/schemas/project.schema';
import {
  Investment,
  InvestmentSchema,
} from '../investments/schemas/investment.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import { Deposit, DepositSchema } from '../escrow/schemas/escrow.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Project.name, schema: ProjectSchema },
      { name: Investment.name, schema: InvestmentSchema },
      { name: User.name, schema: UserSchema },
      { name: Deposit.name, schema: DepositSchema },
    ]),
  ],
  controllers: [
    PublicStatisticsController,
    UserStatisticsController,
    AdminStatisticsController,
  ],
  providers: [StatisticsService],
  exports: [StatisticsService],
})
export class StatisticsModule {}
