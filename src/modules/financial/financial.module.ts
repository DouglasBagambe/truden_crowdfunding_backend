import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FinancialController } from './financial.controller';
import { FinancialDatabase } from './financial.database';
import { FinancialService } from './financial.service';
import { DpoFinancialAdapter } from './providers/dpo-financial.adapter';
import { FlutterwaveFinancialAdapter } from './providers/flutterwave-financial.adapter';
import {
  FinancialProjection,
  FinancialProjectionSchema,
} from './projections/financial-projection.schema';
import { FinancialProjectionService } from './projections/financial-projection.service';
import { FinancialOutboxService } from './financial-outbox.service';
import { FinancialProjectionWorker } from './projections/financial-projection.worker';
import { FinancialWorkersService } from './financial-workers.service';
import { FinancialJobsService } from './financial-jobs.service';
import { FinancialPayoutService } from './financial-payout.service';
import { FinancialPayoutWorker } from './financial-payout.worker';
import { ProjectsModule } from '../projects/projects.module';
import { UsersModule } from '../users/users.module';
import { HttpModule } from '@nestjs/axios';
import { FlutterwaveV4PayoutAdapter } from './providers/flutterwave-v4-payout.adapter';
import { FinancialReceiptService } from './financial-receipt.service';
import { FinancialReceiptWorker } from './financial-receipt.worker';
import { KeiboInvestmentReceiptService } from '../investments/services/keibo-investment-receipt.service';

@Module({
  imports: [
    ProjectsModule,
    UsersModule,
    HttpModule,
    MongooseModule.forFeature([
      { name: FinancialProjection.name, schema: FinancialProjectionSchema },
    ]),
  ],
  controllers: [FinancialController],
  providers: [
    FinancialDatabase,
    FinancialService,
    FlutterwaveFinancialAdapter,
    FlutterwaveV4PayoutAdapter,
    DpoFinancialAdapter,
    FinancialProjectionService,
    FinancialOutboxService,
    FinancialProjectionWorker,
    FinancialWorkersService,
    FinancialJobsService,
    FinancialPayoutService,
    FinancialPayoutWorker,
    FinancialReceiptService,
    FinancialReceiptWorker,
    KeiboInvestmentReceiptService,
  ],
  exports: [
    FinancialService,
    DpoFinancialAdapter,
    FinancialProjectionService,
    FinancialOutboxService,
    FinancialProjectionWorker,
    FinancialJobsService,
  ],
})
export class FinancialModule {}
