import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { PaymentsService } from './payments.service';
import { FlutterwaveService } from './flutterwave.service';
import { DpoService } from './dpo.service';
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
        EventEmitterModule.forRoot(),
        MongooseModule.forFeature([
            { name: PaymentTransaction.name, schema: PaymentTransactionSchema },
            { name: Wallet.name, schema: WalletSchema },
        ]),
    ],
    controllers: [PaymentsController, WalletController],
    providers: [PaymentsService, FlutterwaveService, DpoService],
    exports: [PaymentsService, FlutterwaveService, DpoService],
})
export class PaymentsModule { }

