import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { CommonModule } from '../../common/common.module';
import { InvestmentsController } from './controllers/investments.controller';
import { InvestmentsService } from './services/investments.service';
import { InvestmentNFTService } from './services/investment-nft.service';
import { PaymentInvestmentListener } from './listeners/payment-investment.listener';
import { Investment, InvestmentSchema } from './schemas/investment.schema';
import { AuthModule } from '../auth/auth.module';
import { ProjectsModule } from '../projects/projects.module';
import { PaymentsModule } from '../payments/payments.module';
import { NftModule } from '../nfts/nft.module';
import { UsersModule } from '../users/users.module';
import { RolesGuard } from '../../common/guards/roles.guard';
import {
  PaymentTransaction,
  PaymentTransactionSchema,
} from '../payments/schemas/payment-transaction.schema';

@Module({
  imports: [
    CommonModule,
    MongooseModule.forFeature([
      { name: Investment.name, schema: InvestmentSchema },
      { name: PaymentTransaction.name, schema: PaymentTransactionSchema },
    ]),
    EventEmitterModule.forRoot(),
    AuthModule,
    ProjectsModule,
    PaymentsModule,
    NftModule, // provides ViemNftClient
    UsersModule,
  ],
  controllers: [InvestmentsController],
  providers: [
    InvestmentsService,
    InvestmentNFTService,
    PaymentInvestmentListener,
    RolesGuard,
  ],
  exports: [InvestmentsService, InvestmentNFTService],
})
export class InvestmentsModule { }
