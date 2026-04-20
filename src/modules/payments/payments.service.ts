import {
    Injectable,
    Logger,
    NotFoundException,
    BadRequestException,
    ForbiddenException,
    OnModuleDestroy,
    OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { FlutterwaveService } from './flutterwave.service';
import {
    PaymentTransaction,
    PaymentTransactionDocument,
    PaymentStatus,
    PaymentMethod,
    PaymentProvider,
} from './schemas/payment-transaction.schema';
import { Wallet, WalletDocument } from './schemas/wallet.schema';
import { InitializePaymentDto } from './dto/initialize-payment.dto';
import {
    DepositToWalletDto,
    WithdrawFromWalletDto,
    AddWithdrawalMethodDto,
    WalletInvestmentDto,
} from './dto/wallet.dto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DpoService } from './dpo.service';
import { ConfigService } from '@nestjs/config';
import { ProjectsService } from '../projects/projects.service';
import { hasBackendRoiAccess } from '../../common/utils/roi-access.util';
import { UsersRepository } from '../users/repositories/users.repository';
import { AppEmailService } from '../../common/services/app-email.service';
import {
    amountsMatch,
    calculateDpoIncomingQuote,
    parseProviderAmount,
    resolveIncomingFeeConfig,
    normalizeDpoResult,
} from './dpo-payment.util';

@Injectable()
export class PaymentsService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(PaymentsService.name);
    private payoutReconciliationTimer?: NodeJS.Timeout;

    constructor(
        @InjectModel(PaymentTransaction.name)
        private paymentTransactionModel: Model<PaymentTransactionDocument>,
        @InjectModel(Wallet.name)
        private walletModel: Model<WalletDocument>,
        private flutterwaveService: FlutterwaveService,
        private dpoService: DpoService,
        private eventEmitter: EventEmitter2,
        private configService: ConfigService,
        private projectsService: ProjectsService,
        private usersRepository: UsersRepository,
        private appEmailService: AppEmailService,
    ) { }

    private asRecord(value: unknown): Record<string, unknown> | undefined {
        return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
    }

    private getUserDisplayName(user: any, fallback: string = 'there'): string {
        const profile = user?.profile || {};
        const displayName = typeof profile.displayName === 'string' ? profile.displayName.trim() : '';
        const firstName = typeof profile.firstName === 'string' ? profile.firstName.trim() : '';
        const lastName = typeof profile.lastName === 'string' ? profile.lastName.trim() : '';
        const fullName = `${firstName} ${lastName}`.trim();
        return displayName || fullName || user?.email || fallback;
    }

    private formatAmount(currency: string, amount: number): string {
        return `${currency.toUpperCase()} ${Number(amount || 0).toLocaleString()}`;
    }

    private async sendWithdrawalEmail(
        userId: string,
        details: {
            subject: string;
            body: string;
        },
    ) {
        const user = await this.usersRepository.findById(userId);
        if (!user?.email) {
            return;
        }

        const name = this.getUserDisplayName(user);
        await this.appEmailService.send({
            to: user.email,
            subject: details.subject,
            text: `Hi ${name}, ${details.body}`,
            html: `<p>Hi ${name},</p><p>${details.body}</p>`,
        });
    }

    private normalizeProjectType(value: unknown): 'CHARITY' | 'ROI' | '' {
        if (typeof value !== 'string') {
            return '';
        }

        const normalized = value.trim().toUpperCase();
        if (normalized === 'CHARITY' || normalized === 'ROI') {
            return normalized;
        }

        return '';
    }

    async resolveCheckoutProject(projectId: string) {
        const project = await this.projectsService.ensureProjectExists(projectId);
        const projectType = this.normalizeProjectType(
            (project as any).projectType ?? (project as any).type,
        );

        if (!projectType) {
            throw new BadRequestException('Project type is invalid for checkout');
        }

        return { project, projectType };
    }

    private getDpoIncomingFeeConfig() {
        return resolveIncomingFeeConfig({
            dpoFeeBps: this.configService.get<string>('DPO_FEE_RATE_BPS'),
            dpoVatBps: this.configService.get<string>('DPO_FEE_VAT_RATE_BPS'),
            keiboFeeBps: this.configService.get<string>('KEIBO_INBOUND_FEE_RATE_BPS'),
        });
    }

    private buildDpoIncomingQuote(requestedAmount: number, currency: string) {
        try {
            return calculateDpoIncomingQuote({
                requestedAmount,
                currency,
                config: this.getDpoIncomingFeeConfig(),
            });
        } catch (error: unknown) {
            throw new BadRequestException(
                (error as Error)?.message || 'Unable to calculate the DPO payment quote.',
            );
        }
    }

    async getDPOPaymentQuote(dto: {
        projectId: string;
        amount: number;
        currency?: string;
    }) {
        const { project, projectType } = await this.resolveCheckoutProject(dto.projectId);
        const currency = (dto.currency || 'UGX').toUpperCase();
        if (projectType === 'CHARITY') {
            await this.projectsService.ensureProjectCanReceiveDonation(dto.projectId);
        } else {
            await this.projectsService.ensureProjectIsOpenForInvestment(dto.projectId);
            const projectOnchainId = String((project as any).projectOnchainId || '').trim();
            if (!projectOnchainId || projectOnchainId === '0') {
                throw new BadRequestException(
                    'ROI checkout is unavailable until this project has been provisioned on-chain.',
                );
            }
        }
        const quote = this.buildDpoIncomingQuote(dto.amount, currency);

        return {
            projectId: dto.projectId,
            projectType,
            projectName: String((project as any).name || 'project'),
            currency,
            requestedAmount: quote.requestedAmount,
            grossAmount: quote.grossAmount,
            dpoFee: quote.dpoFee,
            dpoVat: quote.dpoVat,
            keiboFee: quote.keiboFee,
            providerNetAmount: quote.providerNetAmount,
            projectNetAmount: quote.projectNetAmount,
            roundingAdjustment: quote.roundingAdjustment,
        };
    }

    async creditTreasuryInboundFee(currency: string, amount: number) {
        const treasuryUserId = this.configService.get<string>('KEIBO_TREASURY_USER_ID');
        const normalizedAmount = Number(amount || 0);
        if (!treasuryUserId || normalizedAmount <= 0) {
            return false;
        }

        const treasuryWallet = await this.getOrCreateWallet(treasuryUserId);
        (treasuryWallet.fiatBalance as any)[currency] =
            ((treasuryWallet.fiatBalance as any)[currency] || 0) + normalizedAmount;
        treasuryWallet.markModified('fiatBalance');
        await treasuryWallet.save();
        return true;
    }

    private verifyDpoSettlementData(
        transaction: PaymentTransactionDocument,
        verify: Awaited<ReturnType<DpoService['verifyToken']>>,
    ): { ok: boolean; reason?: string } {
        const metadata = this.asRecord(transaction.metadata) || {};
        const quote = this.asRecord(metadata.dpoQuote) || {};
        const expectedCompanyRef = String(metadata.companyRef || '').trim();
        const expectedCurrency = transaction.currency.toUpperCase();
        const expectedGrossAmount =
            Number(quote.grossAmount || transaction.amount || 0);
        const expectedProviderNetAmount = Number(
            quote.providerNetAmount || quote.projectNetAmount || 0,
        );

        if (expectedCompanyRef && verify.companyRef && verify.companyRef !== expectedCompanyRef) {
            return { ok: false, reason: 'DPO company reference mismatch' };
        }

        if (verify.currency && verify.currency.toUpperCase() !== expectedCurrency) {
            return { ok: false, reason: 'DPO currency mismatch' };
        }

        if (!amountsMatch({
            expected: expectedGrossAmount,
            actual: parseProviderAmount(verify.amount),
            currency: expectedCurrency,
        })) {
            return { ok: false, reason: 'DPO charged amount mismatch' };
        }

        const actualProviderNetAmount = parseProviderAmount(verify.netAmount);
        if (
            expectedProviderNetAmount > 0 &&
            actualProviderNetAmount !== null &&
            !amountsMatch({
                expected: expectedProviderNetAmount,
                actual: actualProviderNetAmount,
                currency: expectedCurrency,
            })
        ) {
            return { ok: false, reason: 'DPO net settlement mismatch' };
        }

        return { ok: true };
    }

    private async synchronizeDpoTransaction(
        transaction: PaymentTransactionDocument,
        verify: Awaited<ReturnType<DpoService['verifyToken']>>,
        sourcePayload?: Record<string, unknown>,
    ) {
        const mergedWebhookData = {
            ...(sourcePayload || {}),
            verify,
        };
        const disposition = normalizeDpoResult(verify.status);

        if (disposition.paymentStatus === PaymentStatus.Successful) {
            const settlementCheck = this.verifyDpoSettlementData(transaction, verify);
            if (!settlementCheck.ok) {
                await this.markTransactionFailedIfUnsettled(
                    String(transaction._id),
                    settlementCheck.reason || 'DPO settlement verification failed',
                    mergedWebhookData,
                );
                return PaymentStatus.Failed;
            }

            const changed = await this.markTransactionSuccessful(
                String(transaction._id),
                mergedWebhookData,
            );

            if (changed) {
                this.eventEmitter.emit('payment.successful', {
                    transactionId: transaction._id,
                    userId: transaction.userId,
                    projectId: transaction.projectId,
                    amount: transaction.amount,
                    currency: transaction.currency,
                    projectType: (transaction.metadata as any)?.projectType,
                    walletAddress: (transaction.metadata as any)?.walletAddress || undefined,
                });
            }

            return PaymentStatus.Successful;
        }

        if (disposition.paymentStatus === PaymentStatus.Pending) {
            return PaymentStatus.Pending;
        }

        await this.markTransactionFailedIfUnsettled(
            String(transaction._id),
            verify.message || 'Payment could not be confirmed with DPO',
            mergedWebhookData,
        );
        return disposition.paymentStatus;
    }

    onModuleInit() {
        this.payoutReconciliationTimer = setInterval(() => {
            void this.reconcileProcessingPayouts();
        }, 60_000);
    }

    onModuleDestroy() {
        if (this.payoutReconciliationTimer) {
            clearInterval(this.payoutReconciliationTimer);
            this.payoutReconciliationTimer = undefined;
        }
    }

    private getPayoutCallbackToken(): string {
        return (
            this.configService.get<string>('FLUTTERWAVE_PAYOUT_CALLBACK_TOKEN') ||
            this.configService.get<string>('FLUTTERWAVE_WEBHOOK_SECRET') ||
            ''
        ).trim();
    }

    private getProviderTransferId(payload: any): string | undefined {
        const rawId =
            payload?.data?.id ??
            payload?.data?.data?.id ??
            payload?.data?.transfer_id ??
            payload?.transfer_id ??
            payload?.id;

        if (rawId === undefined || rawId === null) {
            return undefined;
        }

        return String(rawId);
    }

    private async markTransactionSuccessful(
        transactionId: string,
        webhookData?: Record<string, unknown>,
    ): Promise<boolean> {
        const updateResult = await this.paymentTransactionModel.updateOne(
            {
                _id: new Types.ObjectId(transactionId),
                status: { $ne: PaymentStatus.Successful },
            },
            {
                $set: {
                    status: PaymentStatus.Successful,
                    completedAt: new Date(),
                    ...(webhookData ? { webhookData } : {}),
                },
                $unset: {
                    failureReason: 1,
                },
            },
        );

        return updateResult.modifiedCount > 0;
    }

    private async markTransactionFailedIfUnsettled(
        transactionId: string,
        reason: string,
        webhookData?: Record<string, unknown>,
    ) {
        await this.paymentTransactionModel.updateOne(
            {
                _id: new Types.ObjectId(transactionId),
                status: { $nin: [PaymentStatus.Successful, PaymentStatus.Failed] },
            },
            {
                $set: {
                    status: PaymentStatus.Failed,
                    failureReason: reason,
                    ...(webhookData ? { webhookData } : {}),
                },
            },
        );
    }

    private async confirmPayoutState(
        transaction: PaymentTransactionDocument,
        payload?: Record<string, unknown>,
    ) {
        const providerTransferId = String(
            transaction.metadata?.payoutTransferId || this.getProviderTransferId(payload) || '',
        ).trim();

        if (!providerTransferId) {
            const payloadData = this.asRecord(payload);
            const nestedData = this.asRecord(payloadData?.data);
            return {
                normalizedStatus: String(nestedData?.status || payloadData?.status || '').toLowerCase(),
                providerData: payload,
            };
        }

        const providerResponse = await this.flutterwaveService.getTransfer(providerTransferId);
        const providerData = providerResponse?.data || providerResponse;
        const providerReference = String(
            providerData?.reference || providerData?.tx_ref || providerData?.txRef || '',
        ).trim();

        if (providerReference && providerReference !== transaction.flutterwaveReference) {
            throw new ForbiddenException('Payout callback reference mismatch');
        }

        return {
            normalizedStatus: String(providerData?.status || '').toLowerCase(),
            providerData,
        };
    }

    private async reconcileProcessingPayouts() {
        try {
            const candidates = await this.paymentTransactionModel
                .find({
                    provider: PaymentProvider.Flutterwave,
                    status: PaymentStatus.Processing,
                    'metadata.type': { $in: ['WITHDRAWAL_CHARITY', 'WITHDRAWAL_ROI'] },
                    'metadata.payoutTransferId': { $exists: true, $ne: null },
                })
                .sort({ createdAt: 1 })
                .limit(20);

            for (const transaction of candidates) {
                try {
                    const { normalizedStatus, providerData } = await this.confirmPayoutState(transaction);
            if (['successful', 'success', 'completed'].includes(normalizedStatus)) {
                const changed = await this.markTransactionSuccessful(String(transaction._id), providerData);
                if (changed) {
                    await this.sendWithdrawalEmail(String(transaction.userId), {
                        subject: 'Withdrawal completed',
                        body: `Your withdrawal of ${this.formatAmount(transaction.currency, Math.abs(transaction.amount))} has been completed successfully.`,
                    });
                }
                continue;
            }

                    if (['failed', 'error', 'cancelled', 'reversed'].includes(normalizedStatus)) {
                        await this.refundFailedWithdrawal(
                            transaction,
                            String(providerData?.complete_message || providerData?.message || 'Payout failed'),
                            providerData,
                        );
                    }
                } catch (error: any) {
                    this.logger.warn(
                        `Failed payout reconciliation for ${transaction.flutterwaveReference}: ${error.message}`,
                    );
                }
            }
        } catch (error: any) {
            this.logger.warn(`Payout reconciliation loop failed: ${error.message}`);
        }
    }

    /**
     * Initialize a payment for investment
     */
    async initializePayment(dto: InitializePaymentDto, userId: string) {
        // Generate unique transaction reference
        const txRef = `INV-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        // Create payment transaction record
        const transaction = await this.paymentTransactionModel.create({
            userId: new Types.ObjectId(userId),
            projectId: new Types.ObjectId(dto.projectId),
            amount: dto.amount,
            currency: dto.currency || 'UGX',
            paymentMethod: dto.paymentMethod,
            provider: PaymentProvider.Flutterwave,
            flutterwaveReference: txRef,
            phoneNumber: dto.phoneNumber,
            mobileMoneyProvider: dto.mobileMoneyProvider,
            status: PaymentStatus.Pending,
            metadata: {
                redirectUrl: dto.redirectUrl,
            },
        });

        // Initialize payment with Flutterwave
        const flwResponse = await this.flutterwaveService.initializePayment(
            dto,
            userId,
            txRef,
        );

        // Update transaction with Flutterwave response
        transaction.flutterwavePaymentLink = flwResponse.data?.link || flwResponse.meta?.authorization?.redirect;
        transaction.metadata = {
            ...transaction.metadata,
            flutterwaveResponse: flwResponse,
        };
        await transaction.save();

        this.logger.log(`Payment initialized for user ${userId}: ${transaction._id}`);

        return {
            transactionId: transaction._id,
            paymentLink: transaction.flutterwavePaymentLink,
            reference: txRef,
            status: transaction.status,
        };
    }

    /**
     * Verify payment transaction
     */
    async verifyPayment(txRef: string) {
        const transaction = await this.paymentTransactionModel.findOne({
            flutterwaveReference: txRef,
        });

        if (!transaction) {
            throw new NotFoundException('Transaction not found');
        }

        // Verify with Flutterwave
        const flwResponse = await this.flutterwaveService.verifyTransaction(
            transaction.flutterwaveTransactionId || txRef,
        );

        // Update transaction status
        if (flwResponse.data?.status === 'successful') {
            transaction.flutterwaveTransactionId = flwResponse.data.id;
            transaction.webhookData = flwResponse.data;
            await transaction.save();

            const changed = await this.markTransactionSuccessful(
                String(transaction._id),
                flwResponse.data,
            );

            if (changed) {
                this.eventEmitter.emit('payment.successful', {
                    transactionId: transaction._id,
                    userId: transaction.userId,
                    projectId: transaction.projectId,
                    amount: transaction.amount,
                    currency: transaction.currency,
                });
            }
        } else if (flwResponse.data?.status === 'failed') {
            transaction.status = PaymentStatus.Failed;
            transaction.failureReason = flwResponse.data.processor_response || 'Payment failed';
            await transaction.save();
        }

        return {
            status:
                flwResponse.data?.status === 'successful'
                    ? PaymentStatus.Successful
                    : transaction.status,
            transaction: (
                await this.paymentTransactionModel.findById(transaction._id).lean()
            ) || transaction.toObject(),
        };
    }

    /**
     * Handle Flutterwave webhook
     */
    async handleWebhook(signature: string, payload: any) {
        // Verify webhook signature
        const isValid = this.flutterwaveService.verifyWebhookSignature(signature, payload);

        if (!isValid) {
            throw new ForbiddenException('Invalid webhook signature');
        }

        const { txRef, status, amount, currency } = payload.data || payload;

        // Find transaction
        const transaction = await this.paymentTransactionModel.findOne({
            flutterwaveReference: txRef,
        });

        if (!transaction) {
            this.logger.warn(`Webhook received for unknown transaction: ${txRef}`);
            return { received: true };
        }

        // Update transaction
        if (status === 'successful') {
            const changed = await this.markTransactionSuccessful(String(transaction._id), payload);

            if (changed) {
                this.eventEmitter.emit('payment.successful', {
                    transactionId: transaction._id,
                    userId: transaction.userId,
                    projectId: transaction.projectId,
                    amount: transaction.amount,
                    currency: transaction.currency,
                });

                this.logger.log(`Payment successful via webhook: ${txRef}`);
            }
        } else if (status === 'failed') {
            await this.markTransactionFailedIfUnsettled(
                String(transaction._id),
                payload.data?.processor_response || 'Payment failed',
                payload,
            );

            this.logger.log(`Payment failed via webhook: ${txRef}`);
        }

        return { received: true };
    }

    async handlePayoutCallback(payload: any, callbackToken?: string) {
        const expectedToken = this.getPayoutCallbackToken();
        if (!expectedToken) {
            throw new ForbiddenException('Payout callback token is not configured');
        }
        if (callbackToken !== expectedToken) {
            throw new ForbiddenException('Invalid payout callback token');
        }

        const data = payload?.data || payload || {};
        const reference = data.reference || data.tx_ref || data.txRef;

        if (!reference) {
            this.logger.warn('Payout callback received without reference');
            return { received: true };
        }

        const transaction = await this.paymentTransactionModel.findOne({
            flutterwaveReference: reference,
        });

        if (!transaction) {
            this.logger.warn(`Payout callback received for unknown transfer reference: ${reference}`);
            return { received: true };
        }

        const { normalizedStatus, providerData } = await this.confirmPayoutState(transaction, payload);

        transaction.webhookData = providerData || payload;
        if (providerData && !transaction.metadata?.payoutTransferId) {
            transaction.metadata = {
                ...(transaction.metadata || {}),
                payoutTransferId: this.getProviderTransferId(providerData),
            };
            transaction.markModified('metadata');
        }
        await transaction.save();

        if (['successful', 'success', 'completed'].includes(normalizedStatus)) {
            const changed = await this.markTransactionSuccessful(String(transaction._id), providerData || payload);
            if (changed) {
                await this.sendWithdrawalEmail(String(transaction.userId), {
                    subject: 'Withdrawal completed',
                    body: `Your withdrawal of ${this.formatAmount(transaction.currency, Math.abs(transaction.amount))} has been completed successfully.`,
                });
            }
            this.logger.log(`Payout marked successful: ${reference}`);
            return { received: true };
        }

        if (['failed', 'error', 'cancelled', 'reversed'].includes(normalizedStatus)) {
            await this.refundFailedWithdrawal(
                transaction,
                String(
                    (providerData as any)?.complete_message ||
                    (providerData as any)?.message ||
                    data.message ||
                    data.complete_message ||
                    'Payout failed',
                ),
                providerData || payload,
            );
            this.logger.warn(`Payout failed and refunded: ${reference}`);
            return { received: true };
        }

        return { received: true };
    }

    /**
     * Get or create wallet for user
     */
    async getOrCreateWallet(userId: string): Promise<WalletDocument> {
        let wallet = await this.walletModel.findOne({ userId: new Types.ObjectId(userId) });

        if (!wallet) {
            wallet = await this.walletModel.create({
                userId: new Types.ObjectId(userId),
                fiatBalance: { UGX: 0, USD: 0 },
                roiBalance: { UGX: 0, USD: 0 },
                cryptoBalance: { ETH: 0, USDC: 0 },
            });
            this.logger.log(`Wallet created for user ${userId}`);
        }

        return wallet;
    }

    /**
     * Deposit to wallet via Flutterwave
     */
    async depositToWallet(dto: DepositToWalletDto, userId: string, email: string) {
        void dto;
        void userId;
        void email;
        throw new BadRequestException(
            'Wallet deposits are not currently enabled. Use project checkout instead.',
        );
    }

    /**
     * Process wallet investment (deduct from wallet balance)
     */
    async processWalletInvestment(dto: WalletInvestmentDto, userId: string) {
        void dto;
        void userId;
        throw new BadRequestException(
            'Wallet-funded ROI investments are disabled. Use the DPO checkout flow instead.',
        );
    }

    /**
     * Withdraw from wallet.
     * A 2% platform fee is charged on every withdrawal.
     * The fee goes to the Keibo Treasury wallet (KEIBO_TREASURY_USER_ID env var).
     */
    async withdrawFromWallet(dto: WithdrawFromWalletDto, userId: string) {
        const wallet = await this.getOrCreateWallet(userId);

        // Check balance
        const currency = dto.currency.toUpperCase();
        const isRoi = dto.balanceType === 'ROI';

        if (isRoi && !hasBackendRoiAccess(userId, this.configService)) {
            throw new ForbiddenException('ROI withdrawals are restricted for this account');
        }

        const balance = isRoi
            ? ((wallet.roiBalance as any)?.[currency] || 0)
            : ((wallet.fiatBalance as any)?.[currency] || 0);

        if (balance < dto.amount) {
            throw new BadRequestException(`Insufficient ${isRoi ? 'ROI' : 'Charity'} ${currency} balance`);
        }

        // Validate amount based on type
        if (!isRoi && dto.amount < 500) {
            throw new BadRequestException('Minimum charity withdrawal is UGX 500');
        }

        if (isRoi && dto.projectId) {
            const project = await this.walletModel.db.collection('projects').findOne({ _id: new Types.ObjectId(dto.projectId) });
            if (!project) throw new BadRequestException('Project not found');
            const targetAmount = project.goalAmount || project.targetAmount || 1;
            if ((project.raisedAmount || 0) < targetAmount) {
                throw new BadRequestException('ROI investments can only be withdrawn once the project hits 100% of its target');
            }
        }

        // Get withdrawal method
        const method = wallet.withdrawalMethods[dto.withdrawalMethodIndex];
        if (!method || !method.isActive) {
            throw new BadRequestException('Invalid withdrawal method');
        }

        // ── 2% Platform Fee ──────────────────────────────────────────
        const PLATFORM_FEE_RATE = 0.02; // 2%
        const platformFee = Math.ceil(dto.amount * PLATFORM_FEE_RATE);
        const payoutAmount = dto.amount - platformFee; // Creator receives 98%
        // ─────────────────────────────────────────────────────────────

        // Create payout reference
        const payoutRef = `PAYOUT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        if (isRoi) {
            // Deduct requested amount from creator's ROI wallet
            (wallet.roiBalance as any)[currency] -= dto.amount;
            wallet.markModified('roiBalance');
            await wallet.save();

            // Create pending transaction record
            const transaction = await this.paymentTransactionModel.create({
                userId: new Types.ObjectId(userId),
                projectId: new Types.ObjectId(dto.projectId || '000000000000000000000000'),
                amount: -dto.amount, // Negative for withdrawal
                currency: dto.currency,
                paymentMethod: method.type === 'mobile_money' ? PaymentMethod.MobileMoney : PaymentMethod.BankTransfer,
                provider: PaymentProvider.Flutterwave,
                status: PaymentStatus.Pending, // Requires Admin Approval
                metadata: {
                    type: 'WITHDRAWAL_ROI',
                    method,
                    platformFee,
                    payoutAmount,
                    feeRate: PLATFORM_FEE_RATE,
                    pendingApproval: true,
                    note: dto.note,
                },
            });

            this.logger.log(`ROI Withdrawal initiated for user ${userId}: ${transaction._id}. Awaiting admin approval.`);

            await this.sendWithdrawalEmail(userId, {
                subject: 'ROI withdrawal submitted',
                body: `Your ROI withdrawal request for ${this.formatAmount(currency, dto.amount)} has been received. The amount is reserved and is now awaiting administrator approval.`,
            });

            return {
                transactionId: transaction._id,
                status: PaymentStatus.Pending,
                amount: dto.amount,
                platformFee,
                youReceive: payoutAmount,
                providerReference: payoutRef,
                message: 'ROI withdrawal request received. Funds are reserved and now awaiting administrator approval.',
            };
        }

        // Process Charity payout directly with Flutterwave
        const payoutResult = await this.flutterwaveService.processPayout({
            amount: payoutAmount,
            currency: dto.currency,
            accountNumber: method.accountNumber,
            accountBank: method.provider,
            narration: dto.note || 'Wallet withdrawal - Keibo',
            reference: payoutRef,
            beneficiaryName: method.accountName,
            mobileNumber: method.accountNumber,
        });

        // Deduct full requested amount from creator's Charity wallet
        (wallet.fiatBalance as any)[currency] -= dto.amount;
        wallet.markModified('fiatBalance');
        await wallet.save();

        // Credit the 2% fee to the Keibo Treasury wallet
        const treasuryUserId = this.configService.get<string>('KEIBO_TREASURY_USER_ID');
        if (treasuryUserId && platformFee > 0) {
            try {
                const treasuryWallet = await this.getOrCreateWallet(treasuryUserId);
                (treasuryWallet.fiatBalance as any)[currency] =
                    ((treasuryWallet.fiatBalance as any)[currency] || 0) + platformFee;
                treasuryWallet.markModified('fiatBalance');
                await treasuryWallet.save();
                this.logger.log(
                    `Platform fee ${currency} ${platformFee} credited to treasury wallet`,
                );
            } catch (feeErr: any) {
                this.logger.warn(`Failed to credit treasury fee: ${feeErr.message}`);
            }
        }

        // Create transaction record
        const payoutTransferId =
            payoutResult?.data?.id || payoutResult?.data?.data?.id || null;
        const transaction = await this.paymentTransactionModel.create({
            userId: new Types.ObjectId(userId),
            projectId: new Types.ObjectId(dto.projectId || '000000000000000000000000'),
            amount: -dto.amount,
            currency: dto.currency,
            paymentMethod: method.type === 'mobile_money' ? PaymentMethod.MobileMoney : PaymentMethod.BankTransfer,
            provider: PaymentProvider.Flutterwave,
            status: PaymentStatus.Processing,
            flutterwaveReference: payoutRef,
            metadata: {
                type: 'WITHDRAWAL_CHARITY',
                payoutResult,
                payoutTransferId,
                platformFee,
                payoutAmount,
                feeRate: PLATFORM_FEE_RATE,
                method,
            },
        });

        this.logger.log(`Charity Withdrawal processed for user ${userId}`);

        await this.sendWithdrawalEmail(userId, {
            subject: 'Withdrawal submitted',
            body: `Your withdrawal of ${this.formatAmount(currency, dto.amount)} has been submitted to Flutterwave. Final delivery depends on provider confirmation.`,
        });

        return {
            transactionId: transaction._id,
            status: PaymentStatus.Processing,
            amount: dto.amount,
            platformFee,
            youReceive: payoutAmount,
            providerReference: payoutRef,
            providerTransferId: payoutTransferId,
            providerStatus: payoutResult?.status || payoutResult?.data?.status || 'processing',
            message: 'Withdrawal request submitted to Flutterwave. Final delivery depends on network and provider confirmation.',
            newBalance: (wallet.fiatBalance as any)[currency],
        };
    }

    async approveRoiWithdrawal(transactionId: string) {
        const transaction = await this.paymentTransactionModel.findById(transactionId);
        if (!transaction || transaction.status !== PaymentStatus.Pending) {
            throw new BadRequestException('Invalid transaction or not pending approval');
        }

        const payoutRef = `PAYOUT-ROI-${Date.now()}`;
        const payoutResult = await this.flutterwaveService.processPayout({
            amount: transaction.metadata!.payoutAmount,
            currency: transaction.currency,
            accountNumber: transaction.metadata!.method.accountNumber,
            accountBank: transaction.metadata!.method.provider,
            narration: transaction.metadata!.note || 'ROI Wallet withdrawal - Keibo',
            reference: payoutRef,
            beneficiaryName: transaction.metadata!.method.accountName,
            mobileNumber: transaction.metadata!.method.accountNumber,
        });

        const platformFee = transaction.metadata!.platformFee;
        const currency = transaction.currency;
        const treasuryUserId = this.configService.get<string>('KEIBO_TREASURY_USER_ID');
        if (treasuryUserId && platformFee > 0) {
            try {
                const treasuryWallet = await this.getOrCreateWallet(treasuryUserId);
                (treasuryWallet.fiatBalance as any)[currency] =
                    ((treasuryWallet.fiatBalance as any)[currency] || 0) + platformFee;
                treasuryWallet.markModified('fiatBalance');
                await treasuryWallet.save();
            } catch (feeErr: any) {
                this.logger.warn(`Failed to credit treasury fee for approved ROI payout: ${feeErr.message}`);
            }
        }

        transaction.status = PaymentStatus.Processing;
        transaction.flutterwaveReference = payoutRef;
        transaction.metadata!.payoutResult = payoutResult;
        transaction.metadata!.payoutTransferId =
            payoutResult?.data?.id || payoutResult?.data?.data?.id || null;
        transaction.metadata!.pendingApproval = false;
        transaction.markModified('metadata');
        await transaction.save();

        await this.sendWithdrawalEmail(String(transaction.userId), {
            subject: 'ROI withdrawal approved',
            body: `Your ROI withdrawal of ${this.formatAmount(transaction.currency, Math.abs(transaction.amount))} has been approved and submitted to Flutterwave for processing.`,
        });

        return { success: true, message: 'Payout approved and processing' };
    }

    async rejectRoiWithdrawal(transactionId: string) {
        const transaction = await this.paymentTransactionModel.findById(transactionId);
        if (!transaction || transaction.status !== PaymentStatus.Pending) {
            throw new BadRequestException('Invalid transaction or not pending approval');
        }

        // Refund the user's roiBalance
        const wallet = await this.getOrCreateWallet(transaction.userId.toString());
        (wallet.roiBalance as any)[transaction.currency] += Math.abs(transaction.amount);
        wallet.markModified('roiBalance');
        await wallet.save();

        transaction.status = PaymentStatus.Failed;
        transaction.metadata!.pendingApproval = false;
        transaction.metadata!.rejectReason = 'Rejected by administrator';
        transaction.markModified('metadata');
        await transaction.save();

        await this.sendWithdrawalEmail(String(transaction.userId), {
            subject: 'ROI withdrawal rejected',
            body: `Your ROI withdrawal of ${this.formatAmount(transaction.currency, Math.abs(transaction.amount))} was rejected and the full amount has been returned to your wallet.`,
        });

        return { success: true, message: 'Payout rejected and refunded' };
    }

    async getPendingWithdrawals() {
        const transactions = await this.paymentTransactionModel.find({
            status: PaymentStatus.Pending,
            'metadata.type': 'WITHDRAWAL_ROI'
        }).populate('userId', 'firstName lastName email').populate('projectId', 'name').sort({ createdAt: -1 });
        return transactions;
    }

    private async refundFailedWithdrawal(
        transaction: PaymentTransactionDocument,
        reason: string,
        providerData?: Record<string, unknown>,
    ) {
        if (transaction.status === PaymentStatus.Failed || transaction.metadata?.refundApplied) {
            transaction.status = PaymentStatus.Failed;
            transaction.failureReason = reason;
            transaction.metadata = {
                ...(transaction.metadata || {}),
                refundApplied: true,
                ...(providerData ? { payoutResult: providerData } : {}),
            };
            transaction.markModified('metadata');
            await transaction.save();
            return;
        }

        const absoluteAmount = Math.abs(transaction.amount);
        const currency = transaction.currency.toUpperCase();
        const withdrawalType = String(transaction.metadata?.type || '');
        const platformFee = Number(transaction.metadata?.platformFee || 0);

        if (!transaction.userId) {
            transaction.status = PaymentStatus.Failed;
            transaction.failureReason = reason;
            transaction.metadata = {
                ...(transaction.metadata || {}),
                refundApplied: false,
            };
            transaction.markModified('metadata');
            await transaction.save();
            return;
        }

        const wallet = await this.getOrCreateWallet(String(transaction.userId));
        if (withdrawalType === 'WITHDRAWAL_ROI') {
            (wallet.roiBalance as any)[currency] = ((wallet.roiBalance as any)[currency] || 0) + absoluteAmount;
            wallet.markModified('roiBalance');
        } else {
            (wallet.fiatBalance as any)[currency] = ((wallet.fiatBalance as any)[currency] || 0) + absoluteAmount;
            wallet.markModified('fiatBalance');
        }
        await wallet.save();

        const treasuryUserId = this.configService.get<string>('KEIBO_TREASURY_USER_ID');
        if (treasuryUserId && platformFee > 0) {
            try {
                const treasuryWallet = await this.getOrCreateWallet(treasuryUserId);
                const currentTreasuryBalance = Number((treasuryWallet.fiatBalance as any)[currency] || 0);
                (treasuryWallet.fiatBalance as any)[currency] = Math.max(0, currentTreasuryBalance - platformFee);
                treasuryWallet.markModified('fiatBalance');
                await treasuryWallet.save();
            } catch (err: any) {
                this.logger.warn(`Failed to reverse treasury fee for refund: ${err.message}`);
            }
        }

        transaction.status = PaymentStatus.Failed;
        transaction.failureReason = reason;
        transaction.metadata = {
            ...(transaction.metadata || {}),
            refundApplied: true,
            refundReason: reason,
            refundedAt: new Date(),
            ...(providerData ? { payoutResult: providerData } : {}),
        };
        transaction.markModified('metadata');
        await transaction.save();

        await this.sendWithdrawalEmail(String(transaction.userId), {
            subject: 'Withdrawal refunded after provider failure',
            body: `Your withdrawal of ${this.formatAmount(transaction.currency, absoluteAmount)} could not be completed. The amount has been returned to your wallet. Reason: ${reason}.`,
        });
    }

    /**
     * Add withdrawal method
     */
    async addWithdrawalMethod(dto: AddWithdrawalMethodDto, userId: string) {
        const wallet = await this.getOrCreateWallet(userId);

        // If setting as default, unset other defaults
        if (dto.isDefault) {
            wallet.withdrawalMethods.forEach((method) => {
                method.isDefault = false;
            });
        }

        wallet.withdrawalMethods.push({
            type: dto.type,
            provider: dto.provider,
            accountNumber: dto.accountNumber,
            accountName: dto.accountName,
            isDefault: dto.isDefault || false,
            isActive: true,
            addedAt: new Date(),
        });

        await wallet.save();

        this.logger.log(`Withdrawal method added for user ${userId}`);

        const index = wallet.withdrawalMethods.length - 1;
        return {
            index,
            method: wallet.withdrawalMethods[index],
        };
    }

    /**
     * Get user transactions
     */
    async getUserTransactions(userId: string, limit: number = 50) {
        const transactions = await this.paymentTransactionModel
            .find({ userId: new Types.ObjectId(userId) })
            .sort({ createdAt: -1 })
            .limit(limit)
            .populate('projectId', 'name')
            .lean();

        return transactions;
    }

    /**
     * Get transaction by ID
     */
    async getTransaction(transactionId: string) {
        const transaction = await this.paymentTransactionModel
            .findById(transactionId)
            .populate('projectId', 'name')
            .populate('userId', 'email profile.displayName');

        if (!transaction) {
            throw new NotFoundException('Transaction not found');
        }

        return transaction;
    }

    // ─────────────────────────────────────────────────────────────
    // DPO Pay methods
    // ─────────────────────────────────────────────────────────────

    /**
     * Initialize a DPO payment (step 1: get transaction token).
     * Returns the token plus charge instructions when method=mobile_money.
     */
    async initializeDPOPayment(
        dto: {
            projectId: string;
            amount: number;
            currency?: string;
            paymentMethod: PaymentMethod;
            phoneNumber?: string;
            mno?: 'MTN' | 'AIRTEL';
            description?: string;
            projectType?: string;
            donorName?: string;
            walletAddress?: string;
        },
        userId?: string,
    ) {
        const backendUrl = (this.configService.get<string>('BACKEND_URL') ?? 'https://trufund.onrender.com')
            .trim()
            .replace(/[,\s]+$/, '')
            .replace(/\/+$/, '');
        const frontendUrl = (this.configService.get<string>('FRONTEND_URL') ?? 'https://keibo.netlify.app')
            .trim()
            .replace(/[,\s]+$/, '')
            .replace(/\/+$/, '');
        const { project, projectType } = await this.resolveCheckoutProject(dto.projectId);
        const isCharity = projectType === 'CHARITY';

        if (!isCharity && userId && !hasBackendRoiAccess(userId, this.configService)) {
            throw new ForbiddenException('ROI access is restricted for this account');
        }

        if (isCharity) {
            await this.projectsService.ensureProjectCanReceiveDonation(dto.projectId);
        } else {
            await this.projectsService.ensureProjectIsOpenForInvestment(dto.projectId);
            const projectOnchainId = String((project as any).projectOnchainId || '').trim();
            if (!projectOnchainId || projectOnchainId === '0') {
                throw new BadRequestException(
                    'ROI checkout is unavailable until this project has been provisioned on-chain.',
                );
            }
        }

        const normalizedWalletAddress = dto.walletAddress?.trim().toLowerCase() || '';
        if (!isCharity && !normalizedWalletAddress) {
            throw new BadRequestException('Wallet address is required for ROI investments.');
        }

        const currency = (dto.currency ?? 'UGX').toUpperCase();
        const description = dto.description
            ?? (isCharity
                ? `Donation to ${(project as any).name || 'charity project'} - Keibo`
                : `Investment in ${(project as any).name || 'ROI project'} - Keibo`);
        const quote = this.buildDpoIncomingQuote(dto.amount, currency);
        const isLocalDonationBypass =
            isCharity &&
            this.configService.get<string>('NODE_ENV') === 'development' &&
            (backendUrl.includes('localhost') || frontendUrl.includes('localhost'));

        // RedirectURL: user lands here after paying on DPO hosted page (card success path).
        // DPO appends ?ID=<token>&CCDapproval=&PnrID=&TransactionApproval= etc.
        const redirectUrl = `${frontendUrl}/payment/result?projectId=${dto.projectId}`;
        // BackURL: DPO server-to-server IPN (POST) on cancel, and user redirect for mobile-money cancel.
        // Use separate endpoint so we can handle both cases cleanly.
        const backUrl = `${backendUrl}/api/payments/dpo/webhook`;

        const txRef = `DPO-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const companyRef = `KEIBO-${dto.projectId}-${Date.now()}`;
        const token = isLocalDonationBypass
            ? `LOCAL-DPO-${Date.now()}`
            : (await this.dpoService.createToken(
                dto.projectId,
                quote.grossAmount,
                currency,
                backUrl,
                redirectUrl,
                description,
                companyRef,
            )).token;

        const transaction = await this.paymentTransactionModel.create({
            ...(userId ? { userId: new Types.ObjectId(userId) } : {}),
            projectId: new Types.ObjectId(dto.projectId),
            amount: quote.requestedAmount,
            currency,
            paymentMethod: dto.paymentMethod,
            provider: PaymentProvider.DPO,
            dpoToken: token,
            flutterwaveReference: txRef,
            phoneNumber: dto.phoneNumber,
            status: isLocalDonationBypass ? PaymentStatus.Successful : PaymentStatus.Pending,
            ...(isLocalDonationBypass ? { completedAt: new Date() } : {}),
            metadata: {
                projectType,
                description,
                donorName: dto.donorName,
                projectId: dto.projectId,
                walletAddress: normalizedWalletAddress || null,
                projectName: (project as any).name || null,
                localBypass: isLocalDonationBypass,
                companyRef,
                dpoQuote: quote,
            },
        });

        if (isLocalDonationBypass) {
            this.eventEmitter.emit('payment.successful', {
                transactionId: transaction._id,
                userId: transaction.userId,
                projectId: transaction.projectId,
                amount: transaction.amount,
                currency: transaction.currency,
                projectType: (transaction.metadata as any)?.projectType,
                walletAddress: (transaction.metadata as any)?.walletAddress || undefined,
            });

            return {
                token,
                redirectUrl: `${frontendUrl}/payment/result?status=success&projectId=${dto.projectId}`,
                status: PaymentStatus.Successful,
                quote,
            };
        }

        this.logger.log(`DPO payment token created for ${userId ? `user ${userId}` : 'anonymous donor'}: token=${token}`);

        // Return the DPO hosted payment page URL — frontend redirects user here
        return {
            token,
            redirectUrl: `https://secure.3gdirectpay.com/payv3.php?ID=${token}`,
            status: PaymentStatus.Pending,
            quote,
        };
    }

    /**
     * Poll/verify a DPO payment by token (call from frontend while waiting).
     */
    async verifyDPOPayment(token: string) {
        const transaction = await this.paymentTransactionModel.findOne({ dpoToken: token });
        if (!transaction) throw new NotFoundException('DPO transaction not found');

        if ((transaction.metadata as any)?.localBypass) {
            return {
                status: transaction.status,
                verify: {
                    status: '000',
                    message: 'Local development donation bypass confirmed.',
                },
            };
        }

        const verify = await this.dpoService.verifyToken(token);
        await this.synchronizeDpoTransaction(
            transaction,
            verify,
            { source: 'verify' },
        );

        const refreshed = await this.paymentTransactionModel.findById(transaction._id).lean();
        return { status: refreshed?.status || transaction.status, verify };
    }

    /**
     * Handle DPO server-to-server webhook / BackURL callback.
     */
    async handleDPOWebhook(payload: Record<string, string>) {
        const token = payload.TransactionToken ?? payload.token;
        if (!token) return { received: true };

        const transaction = await this.paymentTransactionModel.findOne({ dpoToken: token });
        if (!transaction) {
            this.logger.warn(`DPO webhook: no transaction for token ${token}`);
            return { received: true };
        }

        // Verify with DPO before trusting the webhook payload
        const verify = await this.dpoService.verifyToken(token);

        const resolvedStatus = await this.synchronizeDpoTransaction(
            transaction,
            verify,
            payload,
        );

        this.logger.log(
            `DPO webhook processed: token=${token} providerStatus=${verify.status} appStatus=${resolvedStatus}`,
        );

        return { received: true };
    }
}
