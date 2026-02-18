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

@Injectable()
export class PaymentsService {
    private readonly logger = new Logger(PaymentsService.name);

    constructor(
        @InjectModel(PaymentTransaction.name)
        private paymentTransactionModel: Model<PaymentTransactionDocument>,
        @InjectModel(Wallet.name)
        private walletModel: Model<WalletDocument>,
        private flutterwaveService: FlutterwaveService,
        private eventEmitter: EventEmitter2,
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
     * Withdraw from wallet
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

        // Create payout reference
        const payoutRef = `PAYOUT-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        // Process payout with Flutterwave
        const payoutResult = await this.flutterwaveService.processPayout({
            amount: dto.amount,
            currency: dto.currency,
            accountNumber: method.accountNumber,
            accountBank: method.provider,
            narration: 'Wallet withdrawal',
            reference: payoutRef,
        });

        // Deduct from wallet
        (wallet.fiatBalance as any)[currency] -= dto.amount;
        await wallet.save();

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
            metadata: { payoutResult },
        });

        this.logger.log(`Withdrawal initiated for user ${userId}: ${transaction._id}`);

        return {
            transactionId: transaction._id,
            status: PaymentStatus.Processing,
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
}
