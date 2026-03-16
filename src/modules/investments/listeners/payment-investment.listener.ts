import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Investment, InvestmentDocument } from '../schemas/investment.schema';
import { InvestmentStatus } from '../interfaces/investment.interface';
import { ProjectsService } from '../../projects/projects.service';
import { PaymentsService } from '../../payments/payments.service';
import {
    PaymentTransaction,
    PaymentTransactionDocument,
} from '../../payments/schemas/payment-transaction.schema';

// NOTE: CustodialWalletService and InvestmentNFTService (NFT minting after payment)
// are temporarily removed and preserved in the `blockchain/nfts-future` branch.
// When smart contracts and custodial wallets are ready, restore steps 4 & 5.

export interface PaymentSuccessfulPayload {
    transactionId: Types.ObjectId | string;
    userId: Types.ObjectId | string;
    projectId: Types.ObjectId | string;
    amount: number;
    currency: string;
    projectType?: string; // 'CHARITY' | 'ROI'
}

@Injectable()
export class PaymentInvestmentListener {
    private readonly logger = new Logger(PaymentInvestmentListener.name);

    constructor(
        @InjectModel(Investment.name)
        private readonly investmentModel: Model<InvestmentDocument>,
        @InjectModel(PaymentTransaction.name)
        private readonly paymentTransactionModel: Model<PaymentTransactionDocument>,
        private readonly projectsService: ProjectsService,
        private readonly paymentsService: PaymentsService,
    ) { }

    @OnEvent('payment.successful', { async: true })
    async handlePaymentSuccessful(payload: PaymentSuccessfulPayload): Promise<void> {
        const userId = String(payload.userId);
        const projectId = String(payload.projectId);
        const transactionId = String(payload.transactionId);

        this.logger.log(
            `Payment successful event received: userId=${userId}, projectId=${projectId}, amount=${payload.amount}`,
        );

        try {
            // ── Step 1: Guard against duplicate processing ────────────────────────
            const existing = await this.investmentModel.findOne({
                investorId: new Types.ObjectId(userId),
                projectId: new Types.ObjectId(projectId),
                txHash: transactionId,
            });

            if (existing) {
                this.logger.warn(`Investment already exists for transaction ${transactionId}`);
                return;
            }

            // ── Step 2: Determine project type from payload or transaction metadata
            const tx = await this.paymentTransactionModel.findById(transactionId).lean();
            const projectType = (
                payload.projectType ||
                (tx?.metadata as any)?.projectType ||
                ''
            ).toString().toUpperCase();

            // ── Step 3: Record the investment / donation ──────────────────────────
            if (projectType === 'CHARITY') {
                // Charity donation path — mirror existing working flow
                await this.projectsService.incrementCharityDonation(
                    projectId,
                    payload.amount,
                    userId,
                    (tx?.metadata as any)?.donorName,
                );
            } else {
                // ROI investment path — create investment record + increment raised amount
                const investment = await this.investmentModel.create({
                    projectId: new Types.ObjectId(projectId),
                    investorId: new Types.ObjectId(userId),
                    amount: payload.amount,
                    currency: (payload.currency ?? 'UGX').toUpperCase(),
                    txHash: transactionId,
                    status: InvestmentStatus.Active,
                });

                this.logger.log(`ROI investment created: ${investment._id}`);

                await this.projectsService.incrementFunding(projectId, payload.amount);
            }

            // ── Step 4: Credit creator's Keibo fiat wallet ────────────────────────
            try {
                const project = await this.projectsService.ensureProjectExists(projectId);
                if (project?.creatorId) {
                    const creatorId = String(project.creatorId);
                    const creatorWallet = await this.paymentsService.getOrCreateWallet(creatorId);
                    const currency = (payload.currency ?? 'UGX').toUpperCase();
                    (creatorWallet.fiatBalance as any)[currency] =
                        ((creatorWallet.fiatBalance as any)[currency] || 0) + payload.amount;
                    await creatorWallet.save();
                    this.logger.log(
                        `Credited creator ${creatorId} wallet ${currency} +${payload.amount}`,
                    );
                }
            } catch (creditErr: any) {
                this.logger.error(`Failed to credit creator wallet: ${creditErr.message}`);
                // Non-critical — investment/donation is still recorded; admin can credit manually
            }

            // ── Step 5 (FUTURE): Mint NFT to user's custodial wallet ──────────────
            // Restore from blockchain/nfts-future branch when smart contracts are deployed.
            // See payment-investment.listener.ts in that branch for the full implementation.

        } catch (err: any) {
            this.logger.error(
                `Failed to handle payment.successful for transaction ${transactionId}: ${err.message}`,
                err.stack,
            );
        }
    }
}
