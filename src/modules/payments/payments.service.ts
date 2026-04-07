import {
    Injectable,
    Logger,
    NotFoundException,
    BadRequestException,
    ForbiddenException,
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

@Injectable()
export class PaymentsService {
    private readonly logger = new Logger(PaymentsService.name);

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
    ) { }

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
            transaction.status = PaymentStatus.Successful;
            transaction.completedAt = new Date();
            transaction.flutterwaveTransactionId = flwResponse.data.id;
            transaction.webhookData = flwResponse.data;

            // Emit event for investment processing
            this.eventEmitter.emit('payment.successful', {
                transactionId: transaction._id,
                userId: transaction.userId,
                projectId: transaction.projectId,
                amount: transaction.amount,
                currency: transaction.currency,
            });
        } else if (flwResponse.data?.status === 'failed') {
            transaction.status = PaymentStatus.Failed;
            transaction.failureReason = flwResponse.data.processor_response || 'Payment failed';
        }

        await transaction.save();

        return {
            status: transaction.status,
            transaction: transaction.toObject(),
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
        if (status === 'successful' && transaction.status !== PaymentStatus.Successful) {
            transaction.status = PaymentStatus.Successful;
            transaction.completedAt = new Date();
            transaction.webhookData = payload;
            await transaction.save();

            // Emit event for investment processing
            this.eventEmitter.emit('payment.successful', {
                transactionId: transaction._id,
                userId: transaction.userId,
                projectId: transaction.projectId,
                amount: transaction.amount,
                currency: transaction.currency,
            });

            this.logger.log(`Payment successful via webhook: ${txRef}`);
        } else if (status === 'failed') {
            transaction.status = PaymentStatus.Failed;
            transaction.failureReason = payload.data?.processor_response || 'Payment failed';
            await transaction.save();

            this.logger.log(`Payment failed via webhook: ${txRef}`);
        }

        return { received: true };
    }

    async handlePayoutCallback(payload: any) {
        const data = payload?.data || payload || {};
        const reference = data.reference || data.tx_ref || data.txRef;
        const normalizedStatus = String(data.status || payload?.status || '').toLowerCase();

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

        transaction.webhookData = payload;

        if (
            ['successful', 'success', 'completed'].includes(normalizedStatus) &&
            transaction.status !== PaymentStatus.Successful
        ) {
            transaction.status = PaymentStatus.Successful;
            transaction.completedAt = new Date();
            transaction.failureReason = undefined;
            await transaction.save();
            this.logger.log(`Payout marked successful: ${reference}`);
            return { received: true };
        }

        if (['failed', 'error', 'cancelled', 'reversed'].includes(normalizedStatus)) {
            await this.refundFailedWithdrawal(transaction, data.message || data.complete_message || 'Payout failed');
            this.logger.warn(`Payout failed and refunded: ${reference}`);
            return { received: true };
        }

        await transaction.save();
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
                platformFee,
                payoutAmount,
                feeRate: PLATFORM_FEE_RATE,
                method,
            },
        });

        this.logger.log(`Charity Withdrawal processed for user ${userId}`);

        return {
            transactionId: transaction._id,
            status: PaymentStatus.Processing,
            amount: dto.amount,
            platformFee,
            youReceive: payoutAmount,
            providerReference: payoutRef,
            providerTransferId: payoutResult?.data?.id || payoutResult?.data?.data?.id,
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
        transaction.metadata!.pendingApproval = false;
        transaction.markModified('metadata');
        await transaction.save();

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
    ) {
        if (transaction.status === PaymentStatus.Failed || transaction.metadata?.refundApplied) {
            transaction.status = PaymentStatus.Failed;
            transaction.failureReason = reason;
            transaction.metadata = {
                ...(transaction.metadata || {}),
                refundApplied: true,
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
        };
        transaction.markModified('metadata');
        await transaction.save();
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

        return wallet.withdrawalMethods[wallet.withdrawalMethods.length - 1];
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

        if (isCharity) {
            await this.projectsService.ensureProjectCanReceiveDonation(dto.projectId);
        } else {
            await this.projectsService.ensureProjectIsOpenForInvestment(dto.projectId);
        }

        const normalizedWalletAddress = dto.walletAddress?.trim().toLowerCase() || '';
        if (!isCharity && !normalizedWalletAddress) {
            throw new BadRequestException('Wallet address is required for ROI investments.');
        }

        const currency = dto.currency ?? 'UGX';
        const description = dto.description
            ?? (isCharity
                ? `Donation to ${(project as any).name || 'charity project'} - Keibo`
                : `Investment in ${(project as any).name || 'ROI project'} - Keibo`);
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
        const token = isLocalDonationBypass
            ? `LOCAL-DPO-${Date.now()}`
            : (await this.dpoService.createToken(
                dto.projectId,
                dto.amount,
                currency,
                backUrl,
                redirectUrl,
                description,
            )).token;

        const transaction = await this.paymentTransactionModel.create({
            ...(userId ? { userId: new Types.ObjectId(userId) } : {}),
            projectId: new Types.ObjectId(dto.projectId),
            amount: dto.amount,
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
            };
        }

        this.logger.log(`DPO payment token created for ${userId ? `user ${userId}` : 'anonymous donor'}: token=${token}`);

        // Return the DPO hosted payment page URL — frontend redirects user here
        return {
            token,
            redirectUrl: `https://secure.3gdirectpay.com/payv3.php?ID=${token}`,
            status: PaymentStatus.Pending,
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

        if (verify.status === '000' && transaction.status !== PaymentStatus.Successful) {
            transaction.status = PaymentStatus.Successful;
            transaction.completedAt = new Date();
            await transaction.save();

            this.eventEmitter.emit('payment.successful', {
                transactionId: transaction._id,
                userId: transaction.userId,
                projectId: transaction.projectId,
                amount: transaction.amount,
                currency: transaction.currency,
                projectType: (transaction.metadata as any)?.projectType,
                walletAddress: (transaction.metadata as any)?.walletAddress || undefined,
            });
        } else if (
            verify.status === '801' ||
            verify.status === '804' ||
            verify.status === '900' ||
            verify.status === '001' // 001 = pending mobile money confirmation
        ) {
            // Pending states in DPO — leave transaction as Pending, webhook will finalize
        } else if (verify.status !== '000') {
            transaction.status = PaymentStatus.Failed;
            transaction.failureReason = verify.message;
            await transaction.save();
        }

        return { status: transaction.status, verify };
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

        if (verify.status === '000' && transaction.status !== PaymentStatus.Successful) {
            transaction.status = PaymentStatus.Successful;
            transaction.completedAt = new Date();
            transaction.webhookData = payload;
            await transaction.save();

            this.eventEmitter.emit('payment.successful', {
                transactionId: transaction._id,
                userId: transaction.userId,
                projectId: transaction.projectId,
                amount: transaction.amount,
                currency: transaction.currency,
                projectType: (transaction.metadata as any)?.projectType,
                walletAddress: (transaction.metadata as any)?.walletAddress || undefined,
            });

            this.logger.log(`DPO payment confirmed via webhook: ${token}`);
        } else {
            this.logger.log(`DPO webhook: token=${token} status=${verify.status} (${verify.message}) — current tx status=${transaction.status}`);
        }

        return { received: true };
    }
}
