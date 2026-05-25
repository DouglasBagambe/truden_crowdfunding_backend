import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { CommonModule } from '../../common/common.module';
import { UsersModule } from '../users/users.module';
import { ProjectsModule } from '../projects/projects.module';
import {
    Project,
    ProjectSchema,
    ROIProjectSchema,
    CharityProjectSchema,
} from '../projects/schemas/project.schema';
import {
    CharityDonation,
    CharityDonationSchema,
} from '../projects/schemas/charity-donation.schema';
import { ProjectType } from '../../common/enums/project-type.enum';
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
        CommonModule,
        ConfigModule,
        HttpModule,
        EventEmitterModule.forRoot(),
        UsersModule,
        ProjectsModule,
        MongooseModule.forFeature([
            { name: PaymentTransaction.name, schema: PaymentTransactionSchema },
            { name: Wallet.name, schema: WalletSchema },
            {
                name: Project.name,
                schema: ProjectSchema,
                discriminators: [
                    { name: ProjectType.ROI, schema: ROIProjectSchema },
                    { name: ProjectType.CHARITY, schema: CharityProjectSchema },
                ],
            },
            { name: CharityDonation.name, schema: CharityDonationSchema },
        ]),
    ],
    controllers: [PaymentsController, WalletController],
    providers: [PaymentsService, FlutterwaveService, DpoService],
    exports: [PaymentsService, FlutterwaveService, DpoService],
})
export class PaymentsModule { }
