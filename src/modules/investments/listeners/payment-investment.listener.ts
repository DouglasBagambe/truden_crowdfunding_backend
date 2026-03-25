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
import { InvestmentNFTService } from '../services/investment-nft.service';

export interface PaymentSuccessfulPayload {
    transactionId: Types.ObjectId | string;
    userId: Types.ObjectId | string;
    projectId: Types.ObjectId | string;
    amount: number;
    currency: string;
    projectType?: string; // 'CHARITY' | 'ROI'
    /** Investor's self-custodial wallet address. Provided during checkout. */
    walletAddress?: string;
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
        private readonly investmentNFTService: InvestmentNFTService,
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

            // ── Step 2: Determine project type from payload or transaction metadata ─
            const tx = await this.paymentTransactionModel
                .findById(transactionId)
                .lean() as PaymentTransactionDocument | null;

            const projectType = (
                payload.projectType ||
                (tx?.metadata as any)?.projectType ||
                ''
            ).toString().toUpperCase();

            // Wallet address can come from the event payload or from the tx metadata
            const walletAddress: string | undefined =
                payload.walletAddress ||
                (tx?.metadata as any)?.walletAddress ||
                undefined;

            // ── Step 3: Record the investment / donation ──────────────────────────
            let investment: InvestmentDocument | null = null;

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
                investment = await this.investmentModel.create({
                    projectId: new Types.ObjectId(projectId),
                    investorId: new Types.ObjectId(userId),
                    amount: payload.amount,
                    currency: (payload.currency ?? 'UGX').toUpperCase(),
                    txHash: transactionId,
                    walletAddress: walletAddress?.toLowerCase() ?? null,
                    status: InvestmentStatus.Active,
                    nftMinted: false,
                    listed: false,
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

                    if (projectType === 'CHARITY') {
                        (creatorWallet.fiatBalance as any)[currency] =
                            ((creatorWallet.fiatBalance as any)[currency] || 0) + payload.amount;
                        creatorWallet.markModified('fiatBalance');
                    } else {
                        if (!creatorWallet.roiBalance) creatorWallet.roiBalance = { UGX: 0, USD: 0 };
                        (creatorWallet.roiBalance as any)[currency] =
                            ((creatorWallet.roiBalance as any)[currency] || 0) + payload.amount;
                        creatorWallet.markModified('roiBalance');
                    }

                    await creatorWallet.save();
                    this.logger.log(
                        `Credited creator ${creatorId} wallet ${currency} +${payload.amount}`,
                    );
                }
            } catch (creditErr: any) {
                this.logger.error(`Failed to credit creator wallet: ${creditErr.message}`);
            }

            // ── Step 5: Mint NFT to investor's self-custodial wallet ──────────────
            if (investment && walletAddress && projectType !== 'CHARITY') {
                try {
                    const project = await this.projectsService.ensureProjectExists(projectId);
                    const projectOnchainId = String((project as any).projectOnchainId || projectId.replace(/[^0-9]/g, '').slice(0, 9) || '0');

                    if (!projectOnchainId || projectOnchainId === '0') {
                        this.logger.warn(
                            `Project ${projectId} has no on-chain ID — skipping NFT mint. ` +
                            `Set project.projectOnchainId when creating the project on-chain.`,
                        );
                        return;
                    }

                    const mintResult = await this.investmentNFTService.mintForUser(
                        walletAddress,
                        projectOnchainId,
                        payload.amount,
                        String(investment._id),
                    );

                    // Persist NFT metadata back to the investment record
                    await this.investmentModel.findByIdAndUpdate(investment._id, {
                        nftProjectId: mintResult.tokenId,
                        nftTokenAmount: mintResult.tokenAmount,
                        nftTxHash: mintResult.txHash,
                        nftMinted: true,
                    });

                    this.logger.log(
                        `NFT minted for investment ${investment._id}: tokenId=${mintResult.tokenId}, tx=${mintResult.txHash}`,
                    );
                } catch (nftErr: any) {
                    // Non-fatal — investment is recorded; admin can re-trigger mint manually
                    this.logger.error(
                        `NFT mint failed for investment ${investment._id}: ${nftErr.message}`,
                        nftErr.stack,
                    );
                    await this.investmentModel.findByIdAndUpdate(investment._id, {
                        notes: `NFT mint failed: ${nftErr.message}`,
                    });
                }
            } else if (investment && !walletAddress) {
                this.logger.warn(
                    `Investment ${investment._id} has no wallet address — NFT not minted. ` +
                    `Investor must connect wallet in dashboard to trigger manual mint.`,
                );
            }
        } catch (err: any) {
            this.logger.error(
                `Failed to handle payment.successful for transaction ${transactionId}: ${err.message}`,
                err.stack,
            );
        }
    }
}
