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
    ) { }

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

    /**
     * Get or create wallet for user
     */
    async getOrCreateWallet(userId: string): Promise<WalletDocument> {
        let wallet = await this.walletModel.findOne({ userId: new Types.ObjectId(userId) });

        if (!wallet) {
            wallet = await this.walletModel.create({
                userId: new Types.ObjectId(userId),
                fiatBalance: { UGX: 0, USD: 0 },
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
        const wallet = await this.getOrCreateWallet(userId);

        // Initialize payment
        const paymentDto: InitializePaymentDto = {
            amount: dto.amount,
            currency: dto.currency || 'UGX',
            email,
            paymentMethod: PaymentMethod.Card, // Default to card for deposits
            projectId: 'wallet-deposit', // Special project ID for wallet deposits
            redirectUrl: dto.redirectUrl,
        };

        const result = await this.initializePayment(paymentDto, userId);

        return result;
    }

    /**
     * Process wallet investment (deduct from wallet balance)
     */
    async processWalletInvestment(dto: WalletInvestmentDto, userId: string) {
        const wallet = await this.getOrCreateWallet(userId);

        // Check balance
        const currency = dto.currency.toUpperCase();
        const balance = (wallet.fiatBalance as any)[currency] || 0;

        if (balance < dto.amount) {
            throw new BadRequestException(`Insufficient ${currency} balance`);
        }

        // Deduct from wallet
        (wallet.fiatBalance as any)[currency] -= dto.amount;
        await wallet.save();

        // Create transaction record
        const transaction = await this.paymentTransactionModel.create({
            userId: new Types.ObjectId(userId),
            projectId: new Types.ObjectId(dto.projectId),
            amount: dto.amount,
            currency: dto.currency,
            paymentMethod: PaymentMethod.Wallet,
            provider: PaymentProvider.Flutterwave,
            status: PaymentStatus.Successful,
            completedAt: new Date(),
        });

        // Emit event for investment processing
        this.eventEmitter.emit('payment.successful', {
            transactionId: transaction._id,
            userId: transaction.userId,
            projectId: transaction.projectId,
            amount: transaction.amount,
            currency: transaction.currency,
        });

        this.logger.log(`Wallet investment processed for user ${userId}: ${transaction._id}`);

        return {
            transactionId: transaction._id,
            status: PaymentStatus.Successful,
            newBalance: (wallet.fiatBalance as any)[currency],
        };
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
        const balance = (wallet.fiatBalance as any)[currency] || 0;

        if (balance < dto.amount) {
            throw new BadRequestException(`Insufficient ${currency} balance`);
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

        // Process payout with Flutterwave (pays out the net amount after fee)
        const payoutResult = await this.flutterwaveService.processPayout({
            amount: payoutAmount,
            currency: dto.currency,
            accountNumber: method.accountNumber,
            accountBank: method.provider,
            narration: dto.note || 'Wallet withdrawal - Keibo',
            reference: payoutRef,
        });

        // Deduct full requested amount from creator's wallet
        (wallet.fiatBalance as any)[currency] -= dto.amount;
        await wallet.save();

        // Credit the 2% fee to the Keibo Treasury wallet
        const treasuryUserId = this.configService.get<string>('KEIBO_TREASURY_USER_ID');
        if (treasuryUserId && platformFee > 0) {
            try {
                const treasuryWallet = await this.getOrCreateWallet(treasuryUserId);
                (treasuryWallet.fiatBalance as any)[currency] =
                    ((treasuryWallet.fiatBalance as any)[currency] || 0) + platformFee;
                await treasuryWallet.save();
                this.logger.log(
                    `Platform fee ${currency} ${platformFee} credited to treasury wallet (userId=${treasuryUserId})`,
                );
            } catch (feeErr: any) {
                // Non-critical: fee tracking failed, but payout proceeds
                this.logger.warn(`Failed to credit treasury fee: ${feeErr.message}`);
            }
        } else {
            this.logger.warn(
                `KEIBO_TREASURY_USER_ID not configured. Platform fee ${currency} ${platformFee} was not routed.`,
            );
        }

        // Create transaction record
        const transaction = await this.paymentTransactionModel.create({
            userId: new Types.ObjectId(userId),
            projectId: new Types.ObjectId('000000000000000000000000'), // Dummy project ID for withdrawals
            amount: -dto.amount, // Negative for withdrawal
            currency: dto.currency,
            paymentMethod: method.type === 'mobile_money' ? PaymentMethod.MobileMoney : PaymentMethod.BankTransfer,
            provider: PaymentProvider.Flutterwave,
            status: PaymentStatus.Processing,
            flutterwaveReference: payoutRef,
            metadata: {
                payoutResult,
                platformFee,
                payoutAmount,
                feeRate: PLATFORM_FEE_RATE,
            },
        });

        this.logger.log(`Withdrawal initiated for user ${userId}: ${transaction._id} | amount=${dto.amount} fee=${platformFee} payout=${payoutAmount}`);

        return {
            transactionId: transaction._id,
            status: PaymentStatus.Processing,
            amount: dto.amount,
            platformFee,
            youReceive: payoutAmount,
            newBalance: (wallet.fiatBalance as any)[currency],
        };
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
            projectType?: string; // 'CHARITY' | 'ROI'
            donorName?: string;
        },
        userId: string,
    ) {
        const backendUrl = this.configService.get<string>('BACKEND_URL') ?? 'https://keibo.onrender.com';
        const frontendUrl = this.configService.get<string>('FRONTEND_URL') ?? 'https://keibo.netlify.app';

        const currency = dto.currency ?? 'UGX';
        const isCharity = (dto.projectType ?? '').toUpperCase() === 'CHARITY';
        const description = dto.description
            ?? (isCharity ? 'Donation to charity project - Keibo' : 'Investment in ROI project - Keibo');

        // RedirectURL: user lands here after paying (success)
        const redirectUrl = `${frontendUrl}/payment/result?status=success&projectId=${dto.projectId}`;
        // BackURL: DPO pings this as server-to-server webhook AND sends user here on cancel
        const backUrl = `${backendUrl}/api/payments/dpo/webhook`;

        const { token } = await this.dpoService.createToken(
            dto.projectId,
            dto.amount,
            currency,
            backUrl,
            redirectUrl,
            description,
        );

        const txRef = `DPO-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

        await this.paymentTransactionModel.create({
            userId: new Types.ObjectId(userId),
            projectId: new Types.ObjectId(dto.projectId),
            amount: dto.amount,
            currency,
            paymentMethod: dto.paymentMethod,
            provider: PaymentProvider.DPO,
            dpoToken: token,
            flutterwaveReference: txRef,
            phoneNumber: dto.phoneNumber,
            status: PaymentStatus.Pending,
            metadata: {
                projectType: dto.projectType,
                description,
                donorName: dto.donorName
            },
        });

        this.logger.log(`DPO payment token created for user ${userId}: token=${token}`);

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
            });
        } else if (verify.status !== '000' && verify.status !== 'pending') {
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
            });

            this.logger.log(`DPO payment confirmed via webhook: ${token}`);
        }

        return { received: true };
    }
}

