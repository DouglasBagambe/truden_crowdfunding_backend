import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TreasuryController } from './treasury.controller';
import { TreasuryService } from './treasury.service';
import {
  TreasuryTransaction,
  TreasuryTransactionSchema,
} from './schemas/treasury-transaction.schema';
import { TreasuryWallet, TreasuryWalletSchema } from './schemas/treasury-wallet.schema';
import { ViemTreasuryClient } from './helpers/viem-treasury-client';
import { RolesGuard } from '../../common/guards/roles.guard';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: TreasuryTransaction.name, schema: TreasuryTransactionSchema },
      { name: TreasuryWallet.name, schema: TreasuryWalletSchema },
    ]),
  ],
  controllers: [TreasuryController],
  providers: [TreasuryService, ViemTreasuryClient, RolesGuard],
  exports: [TreasuryService],
})
export class TreasuryModule {}
