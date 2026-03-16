import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { InvestmentsController } from './controllers/investments.controller';
import { InvestmentsService } from './services/investments.service';
import { PaymentInvestmentListener } from './listeners/payment-investment.listener';
import { Investment, InvestmentSchema } from './schemas/investment.schema';
import { AuthModule } from '../auth/auth.module';
import { ProjectsModule } from '../projects/projects.module';
import { PaymentsModule } from '../payments/payments.module';
import { RolesGuard } from '../../common/guards/roles.guard';
import {
  PaymentTransaction,
  PaymentTransactionSchema,
} from '../payments/schemas/payment-transaction.schema';

// NOTE: InvestmentNFTService, CustodialWalletService, EscrowModule, UsersModule
// were removed and are preserved in the `blockchain/nfts-future` branch.
// Restore them here when the NFT/custodial-wallet infrastructure is ready.

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Investment.name, schema: InvestmentSchema },
      { name: PaymentTransaction.name, schema: PaymentTransactionSchema },
    ]),
    EventEmitterModule.forRoot(),
    AuthModule,
    ProjectsModule,
    PaymentsModule,
  ],
  controllers: [InvestmentsController],
  providers: [InvestmentsService, PaymentInvestmentListener, RolesGuard],
  exports: [InvestmentsService],
})
export class InvestmentsModule { }
