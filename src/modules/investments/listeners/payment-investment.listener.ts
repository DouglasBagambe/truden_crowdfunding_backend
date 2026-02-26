import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Investment, InvestmentDocument } from '../schemas/investment.schema';
import { InvestmentStatus } from '../interfaces/investment.interface';
import { InvestmentNFTService } from '../services/investment-nft.service';
import { CustodialWalletService } from '../../users/services/custodial-wallet.service';
import { ProjectsService } from '../../projects/projects.service';
import {
    PaymentTransaction,
    PaymentTransactionDocument,
} from '../../payments/schemas/payment-transaction.schema';

export interface PaymentSuccessfulPayload {
    transactionId: Types.ObjectId | string;
    userId: Types.ObjectId | string;
    projectId: Types.ObjectId | string;
    amount: number;
    currency: string;
}

@Injectable()
export class PaymentInvestmentListener {
    private readonly logger = new Logger(PaymentInvestmentListener.name);

    constructor(
        @InjectModel(Investment.name)
        private readonly investmentModel: Model<InvestmentDocument>,
        @InjectModel(PaymentTransaction.name)
        private readonly paymentTransactionModel: Model<PaymentTransactionDocument>,
        private readonly investmentNFTService: InvestmentNFTService,
        private readonly custodialWalletService: CustodialWalletService,
        private readonly projectsService: ProjectsService,
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
            // 1. Check for existing investment to avoid duplicates
            const existing = await this.investmentModel.findOne({
                investorId: new Types.ObjectId(userId),
                projectId: new Types.ObjectId(projectId),
                txHash: transactionId,
            });

            if (existing) {
                this.logger.warn(`Investment already exists for transaction ${transactionId}`);
                return;
            }

            // 2. Create the investment record
            const investment = await this.investmentModel.create({
                projectId: new Types.ObjectId(projectId),
                investorId: new Types.ObjectId(userId),
                amount: payload.amount,
                txHash: transactionId,
                status: InvestmentStatus.Active,
            });

            this.logger.log(`Investment created: ${investment._id}`);

            // 3. Increment project funding
            try {
                await this.projectsService.incrementFunding(projectId, payload.amount);
            } catch (err: any) {
                this.logger.warn(`Failed to increment project funding: ${err.message}`);
            }

            // 4. Get or create custodial wallet for user
            let custodialAddress: string | null = null;
            try {
                const wallet = await this.custodialWalletService.getOrCreateWallet(userId);
                custodialAddress = wallet.address;
            } catch (err: any) {
                this.logger.warn(`Failed to get custodial wallet for user ${userId}: ${err.message}`);
            }

            // 5. Mint NFT to custodial address
            if (custodialAddress) {
                try {
                    // Fetch project to get onchain ID
                    const project = await this.projectsService.ensureProjectExists(projectId);
                    const projectOnchainId = (project as any).projectOnchainId ?? projectId;

                    const { tokenId, txHash: nftTxHash } =
                        await this.investmentNFTService.mintForUser(
                            custodialAddress,
                            String(projectOnchainId),
                            payload.amount,
                            String(investment._id),
                        );

                    // 6. Update investment with NFT info
                    investment.nftTokenId = tokenId;
                    investment.nftTxHash = nftTxHash;
                    investment.nftId = String(tokenId);
                    await investment.save();

                    // 7. Update payment transaction
                    await this.paymentTransactionModel.findByIdAndUpdate(transactionId, {
                        nftMinted: true,
                        nftTokenId: String(tokenId),
                        blockchainTxHash: nftTxHash,
                        investmentId: investment._id,
                    }).catch(() => {
                        // PaymentTransaction ID is optional here
                    });

                    this.logger.log(
                        `NFT minted for investment ${investment._id}: tokenId=${tokenId}, txHash=${nftTxHash}`,
                    );
                } catch (err: any) {
                    this.logger.error(`NFT minting failed for investment ${investment._id}: ${err.message}`);
                    // Don't fail the investment — NFT minting is non-critical
                }
            }
        } catch (err: any) {
            this.logger.error(
                `Failed to handle payment.successful for transaction ${transactionId}: ${err.message}`,
                err.stack,
            );
        }
    }
}
