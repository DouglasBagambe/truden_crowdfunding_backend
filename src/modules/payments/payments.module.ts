import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { PaymentsService } from './payments.service';
import { FlutterwaveService } from './flutterwave.service';
import { PaymentsController, WalletController } from './payments.controller';
import {
    PaymentTransaction,
    PaymentTransactionSchema,
} from './schemas/payment-transaction.schema';
import { Wallet, WalletSchema } from './schemas/wallet.schema';

@Module({
    imports: [
        ConfigModule,
        HttpModule,
        MongooseModule.forFeature([
            { name: PaymentTransaction.name, schema: PaymentTransactionSchema },
            { name: Wallet.name, schema: WalletSchema },
        ]),
    ],
    controllers: [PaymentsController, WalletController],
    providers: [PaymentsService, FlutterwaveService],
    exports: [PaymentsService, FlutterwaveService],
})
export class PaymentsModule { }
