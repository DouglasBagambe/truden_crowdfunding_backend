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

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: FinancialProjection.name, schema: FinancialProjectionSchema },
    ]),
  ],
  controllers: [FinancialController],
  providers: [
    FinancialDatabase,
    FinancialService,
    FlutterwaveFinancialAdapter,
    DpoFinancialAdapter,
    FinancialProjectionService,
    FinancialOutboxService,
    FinancialProjectionWorker,
    FinancialWorkersService,
  ],
  exports: [
    FinancialService,
    DpoFinancialAdapter,
    FinancialProjectionService,
    FinancialOutboxService,
    FinancialProjectionWorker,
  ],
})
export class FinancialModule {}
