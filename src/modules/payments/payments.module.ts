import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { CommonModule } from '../../common/common.module';
import { UsersModule } from '../users/users.module';
import { ProjectsModule } from '../projects/projects.module';
import { PaymentsService } from './payments.service';
import { FlutterwaveService } from './flutterwave.service';
import { DpoService } from './dpo.service';
import { PaymentsController, WalletController } from './payments.controller';
import {
  PaymentTransaction,
  PaymentTransactionSchema,
} from './schemas/payment-transaction.schema';
import { Wallet, WalletSchema } from './schemas/wallet.schema';
import { FinancialModule } from '../financial/financial.module';

@Module({
  imports: [
    CommonModule,
    ConfigModule,
    HttpModule,
    UsersModule,
    ProjectsModule,
    FinancialModule,
    MongooseModule.forFeature([
      { name: PaymentTransaction.name, schema: PaymentTransactionSchema },
      { name: Wallet.name, schema: WalletSchema },
    ]),
  ],
  controllers: [PaymentsController, WalletController],
  providers: [PaymentsService, FlutterwaveService, DpoService],
  exports: [PaymentsService, FlutterwaveService, DpoService],
})
export class PaymentsModule {}
