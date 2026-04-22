import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import { Investment, InvestmentDocument } from '../schemas/investment.schema';
import { MintStatus } from '../schemas/investment.schema';
import { InvestmentStatus } from '../interfaces/investment.interface';
import { ProjectsService } from '../../projects/projects.service';
import { PaymentsService } from '../../payments/payments.service';
import {
    PaymentTransaction,
    PaymentTransactionDocument,
} from '../../payments/schemas/payment-transaction.schema';
import { InvestmentNFTService } from '../services/investment-nft.service';
import { UsersRepository } from '../../users/repositories/users.repository';
import { AppEmailService } from '../../../common/services/app-email.service';

export interface PaymentSuccessfulPayload {
    transactionId: Types.ObjectId | string;
    userId?: Types.ObjectId | string;
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
        private readonly usersRepository: UsersRepository,
        private readonly appEmailService: AppEmailService,
        private readonly configService: ConfigService,
    ) { }

    private getUserDisplayName(user: any, fallback: string = 'there'): string {
        const profile = user?.profile || {};
        const displayName = typeof profile.displayName === 'string' ? profile.displayName.trim() : '';
        const firstName = typeof profile.firstName === 'string' ? profile.firstName.trim() : '';
        const lastName = typeof profile.lastName === 'string' ? profile.lastName.trim() : '';
        const fullName = `${firstName} ${lastName}`.trim();
        return displayName || fullName || user?.email || fallback;
    }

    private async sendDonationEmails(params: {
        donorEmail?: string;
        donorName?: string;
        creatorEmail?: string;
        creatorName?: string;
        projectName: string;
        amount: number;
        currency: string;
    }) {
        const amountLabel = `${params.currency} ${params.amount.toLocaleString()}`;

        if (params.donorEmail) {
            const donorName = params.donorName || 'there';
            await this.appEmailService.send({
                to: params.donorEmail,
                subject: `Donation confirmed for ${params.projectName}`,
                text: `Hi ${donorName}, your donation of ${amountLabel} to ${params.projectName} has been received on Keibo.`,
                html: `<p>Hi ${donorName},</p><p>Your donation of <strong>${amountLabel}</strong> to <strong>${params.projectName}</strong> has been received on Keibo.</p>`,
            });
        }

        if (params.creatorEmail) {
            const creatorName = params.creatorName || 'there';
            await this.appEmailService.send({
                to: params.creatorEmail,
                subject: `New donation received for ${params.projectName}`,
                text: `Hi ${creatorName}, your campaign ${params.projectName} has received a donation of ${amountLabel}.`,
                html: `<p>Hi ${creatorName},</p><p>Your campaign <strong>${params.projectName}</strong> has received a donation of <strong>${amountLabel}</strong>.</p>`,
            });
        }
    }

    private async sendInvestmentEmails(params: {
        investorEmail?: string;
        investorName?: string;
        creatorEmail?: string;
        creatorName?: string;
        projectName: string;
        amount: number;
        currency: string;
        walletAddress?: string;
        nftMinted: boolean;
        nftNote?: string;
    }) {
        const amountLabel = `${params.currency} ${params.amount.toLocaleString()}`;

        if (params.investorEmail) {
            const investorName = params.investorName || 'there';
            const nftLine = params.nftMinted
                ? 'Your investment NFT has been minted successfully.'
                : params.nftNote || 'Your investment has been recorded, and your NFT is pending follow-up.';
            await this.appEmailService.send({
                to: params.investorEmail,
                subject: `Investment confirmed for ${params.projectName}`,
                text: `Hi ${investorName}, your investment of ${amountLabel} in ${params.projectName} has been confirmed. ${nftLine}${params.walletAddress ? ` Wallet: ${params.walletAddress}` : ''}`,
                html: `<p>Hi ${investorName},</p><p>Your investment of <strong>${amountLabel}</strong> in <strong>${params.projectName}</strong> has been confirmed.</p><p>${nftLine}</p>${params.walletAddress ? `<p>Wallet: <code>${params.walletAddress}</code></p>` : ''}`,
            });
        }

        if (params.creatorEmail) {
            const creatorName = params.creatorName || 'there';
            await this.appEmailService.send({
                to: params.creatorEmail,
                subject: `New investment received for ${params.projectName}`,
                text: `Hi ${creatorName}, your ROI campaign ${params.projectName} has received an investment of ${amountLabel}.`,
                html: `<p>Hi ${creatorName},</p><p>Your ROI campaign <strong>${params.projectName}</strong> has received an investment of <strong>${amountLabel}</strong>.</p>`,
            });
        }
    }

    @OnEvent('payment.successful', { async: true })
    async handlePaymentSuccessful(payload: PaymentSuccessfulPayload): Promise<void> {
        const userId = payload.userId ? String(payload.userId) : undefined;
        const projectId = String(payload.projectId);
        const transactionId = String(payload.transactionId);

        this.logger.log(
            `Payment successful event received: userId=${userId ?? 'anonymous'}, projectId=${projectId}, amount=${payload.amount}`,
        );

        try {
            // ── Step 1: Determine project type from payload or transaction metadata ─
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

            const amountCurrency = (payload.currency ?? 'UGX').toUpperCase();
            const project = await this.projectsService.ensureProjectExists(projectId);
            const projectName = String((project as any).name || 'project');
            const creator = project?.creatorId
                ? await this.usersRepository.findById(String(project.creatorId))
                : null;
            const creatorEmail = creator?.email;
            const creatorName = this.getUserDisplayName(creator);
            const payer = userId ? await this.usersRepository.findById(userId) : null;
            const payerEmail = payer?.email;
            const payerName =
                (tx?.metadata as any)?.donorName ||
                this.getUserDisplayName(payer, 'there');

            // ── Step 3: Record the investment / donation ──────────────────────────
            let investment: InvestmentDocument | null = null;
            let investmentEmailNote = '';
            let investmentNftMinted = false;
            let creatorWalletCredited = false;
            const inboundKeiboFee = Number((tx?.metadata as any)?.dpoQuote?.keiboFee || 0);

            if (projectType === 'CHARITY') {
                // Charity donation path — mirror existing working flow
                await this.projectsService.incrementCharityDonation(
                    projectId,
                    payload.amount,
                    userId,
                    (tx?.metadata as any)?.donorName,
                );

            } else {
                if (!userId) {
                    this.logger.error(`Skipping ROI payment ${transactionId}: missing userId`);
                    return;
                }

                const existing = await this.investmentModel.findOne({
                    investorId: new Types.ObjectId(userId),
                    projectId: new Types.ObjectId(projectId),
                    txHash: transactionId,
                });

                if (existing) {
                    this.logger.warn(`Investment already exists for transaction ${transactionId}`);
                    return;
                }

                // ROI investment path — create investment record + increment raised amount
                const provisioningBypassed =
                    Boolean((tx?.metadata as any)?.provisioningBypassed);

                investment = await this.investmentModel.create({
                    projectId: new Types.ObjectId(projectId),
                    investorId: new Types.ObjectId(userId),
                    amount: payload.amount,
                    currency: (payload.currency ?? 'UGX').toUpperCase(),
                    txHash: transactionId,
                    walletAddress: walletAddress?.toLowerCase() ?? null,
                    status: InvestmentStatus.Active,
                    nftMinted: false,
                    mintStatus: MintStatus.PENDING,
                    mintBypassedProvisioningCheck: provisioningBypassed,
                    listed: false,
                });

                this.logger.log(`ROI investment created: ${investment._id}`);

                await this.projectsService.incrementFunding(projectId, payload.amount);
            }

            // ── Step 4: Credit creator's Keibo fiat wallet ────────────────────────
            try {
                if (project?.creatorId) {
                    const creatorId = String(project.creatorId);
                    const creatorWallet = await this.paymentsService.getOrCreateWallet(creatorId);
                    const currency = amountCurrency;

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
                    creatorWalletCredited = true;
                    this.logger.log(
                        `Credited creator ${creatorId} wallet ${currency} +${payload.amount}`,
                    );
                }
            } catch (creditErr: any) {
                this.logger.error(`Failed to credit creator wallet: ${creditErr.message}`);
            }

            if (inboundKeiboFee > 0) {
                try {
                    await this.paymentsService.creditTreasuryInboundFee(
                        amountCurrency,
                        inboundKeiboFee,
                    );
                } catch (treasuryErr: any) {
                    this.logger.error(
                        `Failed to credit treasury inbound fee: ${treasuryErr.message}`,
                    );
                }
            }

            if (projectType === 'CHARITY') {
                await this.sendDonationEmails({
                    donorEmail: payerEmail,
                    donorName: payerName,
                    creatorEmail: creatorWalletCredited ? creatorEmail : undefined,
                    creatorName,
                    projectName,
                    amount: payload.amount,
                    currency: amountCurrency,
                });
            }

            // ── Step 5: Mint NFT to investor's self-custodial wallet ──────────────
            if (investment && walletAddress && projectType !== 'CHARITY') {
                const requireProvisioning =
                    String(this.configService.get('ROI_REQUIRE_ONCHAIN_PROVISIONING') ?? 'true').toLowerCase() !== 'false';
                const disableNftMinting =
                    String(this.configService.get('ROI_DISABLE_NFT_MINTING') ?? 'false').toLowerCase() === 'true';

                const projectOnchainId = String((project as any).projectOnchainId || '').trim();
                const isProvisioned = projectOnchainId.length > 0 && projectOnchainId !== '0';

                if (disableNftMinting) {
                    // Explicit test-only bypass — never silently skip
                    const bypassReason = 'NFT minting disabled via ROI_DISABLE_NFT_MINTING env flag (test-only bypass)';
                    this.logger.warn(`[BYPASS] Skipping NFT mint for investment ${investment._id}: ${bypassReason}`);
                    await this.investmentModel.findByIdAndUpdate(investment._id, {
                        mintStatus: MintStatus.BYPASSED,
                        mintError: bypassReason,
                    });
                    investmentEmailNote = 'Your investment was recorded. NFT minting is temporarily disabled for testing.';
                } else if (requireProvisioning && !isProvisioned) {
                    // Strict mode: block mint until project is provisioned
                    const pendingReason = `Project ${projectId} has no valid on-chain ID — NFT mint blocked (strict mode). Run admin repair to provision and retry.`;
                    this.logger.warn(pendingReason);
                    await this.investmentModel.findByIdAndUpdate(investment._id, {
                        mintStatus: MintStatus.FAILED,
                        mintError: pendingReason,
                    });
                    investmentEmailNote = 'Your investment was recorded. The NFT mint is pending admin action to provision this project on-chain.';
                } else if (!isProvisioned) {
                    // Bypass mode + not provisioned — record explicitly but don't attempt mint
                    const bypassNote = `Project not provisioned on-chain; provisioning bypass is active. NFT not minted.`;
                    this.logger.warn(`[BYPASS] ${bypassNote} Investment: ${investment._id}`);
                    await this.investmentModel.findByIdAndUpdate(investment._id, {
                        mintStatus: MintStatus.BYPASSED,
                        mintError: bypassNote,
                    });
                    investmentEmailNote = 'Testing mode: your investment was recorded without NFT minting.';
                } else {
                    // Normal path — project is provisioned, proceed with mint
                    try {
                        const mintResult = await this.investmentNFTService.mintForUser(
                            walletAddress,
                            projectOnchainId,
                            payload.amount,
                            String(investment._id),
                        );

                        await this.investmentModel.findByIdAndUpdate(investment._id, {
                            nftProjectId: mintResult.tokenId,
                            nftTokenAmount: mintResult.tokenAmount,
                            nftTxHash: mintResult.txHash,
                            nftMinted: true,
                            mintStatus: MintStatus.MINTED,
                            mintError: null,
                        });

                        investmentNftMinted = true;
                        this.logger.log(
                            `NFT minted for investment ${investment._id}: tokenId=${mintResult.tokenId}, tx=${mintResult.txHash}`,
                        );
                    } catch (nftErr: unknown) {
                        const errMsg = nftErr instanceof Error ? nftErr.message : String(nftErr);
                        const errStack = nftErr instanceof Error ? nftErr.stack : undefined;
                        // Non-fatal — investment is recorded; FAILED status enables admin retry
                        this.logger.error(
                            `NFT mint failed for investment ${investment._id}: ${errMsg}`,
                            errStack,
                        );
                        await this.investmentModel.findByIdAndUpdate(investment._id, {
                            mintStatus: MintStatus.FAILED,
                            mintError: errMsg,
                        });
                        investmentEmailNote = `Your investment was recorded, but NFT minting failed and has been queued for admin retry: ${errMsg}`;
                    }
                }
            } else if (investment && !walletAddress) {
                this.logger.warn(
                    `Investment ${investment._id} has no wallet address — NFT not minted. ` +
                    `Investor must connect wallet in dashboard to trigger manual mint.`,
                );
                await this.investmentModel.findByIdAndUpdate(investment._id, {
                    mintStatus: MintStatus.FAILED,
                    mintError: 'No investor wallet address provided at checkout.',
                });
                investmentEmailNote =
                    'Your investment was recorded, but no wallet address was available for NFT minting. Connect your wallet in the dashboard to complete minting.';
            }

            if (investment) {
                await this.sendInvestmentEmails({
                    investorEmail: payerEmail,
                    investorName: payerName,
                    creatorEmail: creatorWalletCredited ? creatorEmail : undefined,
                    creatorName,
                    projectName,
                    amount: payload.amount,
                    currency: amountCurrency,
                    walletAddress,
                    nftMinted: investmentNftMinted,
                    nftNote: investmentEmailNote,
                });
            }
        } catch (err: any) {
            this.logger.error(
                `Failed to handle payment.successful for transaction ${transactionId}: ${err.message}`,
                err.stack,
            );
        }
    }
}
