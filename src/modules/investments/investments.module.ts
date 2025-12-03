import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { InvestmentsController } from './controllers/investments.controller';
import { InvestmentsService } from './services/investments.service';
import { Investment, InvestmentSchema } from './schemas/investment.schema';
import { AuthModule } from '../auth/auth.module';
import { EscrowModule } from '../escrow/escrow.module';
import { RolesGuard } from '../../common/guards/roles.guard';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Investment.name, schema: InvestmentSchema },
    ]),
    AuthModule,
    EscrowModule,
  ],
  controllers: [InvestmentsController],
  providers: [InvestmentsService, RolesGuard],
  exports: [InvestmentsService],
})
export class InvestmentsModule {}
