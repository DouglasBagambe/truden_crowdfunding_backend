import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { FlutterwaveService } from './flutterwave.service';
import {
  PaymentTransaction,
  PaymentTransactionDocument,
  PaymentStatus,
  PaymentMethod,
  PaymentProvider,
} from './schemas/payment-transaction.schema';
import {
  FiatBalance,
  Wallet,
  WalletDocument,
  WithdrawalMethodType,
} from './schemas/wallet.schema';
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
import { randomUUID } from 'crypto';
import { ProjectsService } from '../projects/projects.service';
import { Project, ProjectDocument } from '../projects/schemas/project.schema';
import {
  CharityDonation,
  CharityDonationDocument,
} from '../projects/schemas/charity-donation.schema';
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
import { FinancialService } from '../financial/financial.service';
import { DpoFinancialAdapter } from '../financial/providers/dpo-financial.adapter';
import { decimalToMinor } from '../financial/providers/provider-adapter';
import type { UserDocument } from '../users/schemas/user.schema';

@Injectable()
export class PaymentsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PaymentsService.name);
  private payoutReconciliationTimer?: NodeJS.Timeout;

  constructor(
    @InjectModel(PaymentTransaction.name)
    private paymentTransactionModel: Model<PaymentTransactionDocument>,
    @InjectModel(Wallet.name)
    private walletModel: Model<WalletDocument>,
    @InjectModel(Project.name)
    private projectModel: Model<ProjectDocument>,
    @InjectModel(CharityDonation.name)
    private charityDonationModel: Model<CharityDonationDocument>,
    @InjectConnection()
    private readonly connection: Connection,
    private flutterwaveService: FlutterwaveService,
    private dpoService: DpoService,
    private eventEmitter: EventEmitter2,
    private configService: ConfigService,
    private projectsService: ProjectsService,
    private usersRepository: UsersRepository,
    private appEmailService: AppEmailService,
    private financialService: FinancialService,
    private dpoFinancialAdapter: DpoFinancialAdapter,
  ) {}

  private asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : undefined;
  }

  private getUserDisplayName(
    user: UserDocument,
    fallback: string = 'there',
  ): string {
    const profile = user.profile;
    const displayName =
      typeof profile.displayName === 'string' ? profile.displayName.trim() : '';
    const firstName =
      typeof profile.firstName === 'string' ? profile.firstName.trim() : '';
    const lastName =
      typeof profile.lastName === 'string' ? profile.lastName.trim() : '';
    const fullName = `${firstName} ${lastName}`.trim();
    return displayName || fullName || user.email || fallback;
  }

  private stringValue(value: unknown): string {
    return typeof value === 'string' || typeof value === 'number'
      ? String(value)
      : '';
  }

  private numberValue(value: unknown, fallback = 0): number {
    return typeof value === 'number' && Number.isFinite(value)
      ? value
      : fallback;
  }

  private getFiatBalance(balance: FiatBalance, currency: string): number {
    if (currency === 'UGX') return balance.UGX;
    if (currency === 'USD') return balance.USD;
    throw new BadRequestException(`Unsupported wallet currency: ${currency}`);
  }

  private setFiatBalance(
    balance: FiatBalance,
    currency: string,
    amount: number,
  ): void {
    if (currency === 'UGX') balance.UGX = amount;
    else if (currency === 'USD') balance.USD = amount;
    else
      throw new BadRequestException(`Unsupported wallet currency: ${currency}`);
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

  private extractObjectId(value: unknown): string | undefined {
    if (!value) {
      return undefined;
    }
    if (typeof value === 'string') {
      return value;
    }
    if (value instanceof Types.ObjectId) {
      return value.toString();
    }
    if (typeof value === 'object' && value !== null) {
      const nestedId = (value as { _id?: unknown })._id;
      if (typeof nestedId === 'string') {
        return nestedId;
      }
      if (nestedId instanceof Types.ObjectId) {
        return nestedId.toString();
      }
    }
    return undefined;
  }

  async resolveCheckoutProject(projectId: string) {
    const project = await this.projectsService.ensureProjectExists(projectId);
    const projectType = this.normalizeProjectType(project.projectType);

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
        (error as Error)?.message ||
          'Unable to calculate the DPO payment quote.',
      );
    }
  }

  async getDPOPaymentQuote(dto: {
    projectId: string;
    amount: number;
    currency?: string;
  }) {
    const { project, projectType } = await this.resolveCheckoutProject(
      dto.projectId,
    );
    const currency = (dto.currency || 'UGX').toUpperCase();
    if (projectType === 'CHARITY') {
      await this.projectsService.ensureProjectCanReceiveDonation(dto.projectId);
    } else {
      await this.projectsService.ensureProjectIsOpenForInvestment(
        dto.projectId,
      );
      const requireProvisioning =
        String(
          this.configService.get<string>('ROI_REQUIRE_ONCHAIN_PROVISIONING') ??
            'true',
        ).toLowerCase() !== 'false';
      const projectOnchainId = project.projectOnchainId?.trim() ?? '';
      const isProvisioned =
        projectOnchainId.length > 0 && projectOnchainId !== '0';
      if (requireProvisioning && !isProvisioned) {
        throw new BadRequestException(
          'ROI checkout is unavailable until this project has been provisioned on-chain.',
        );
      }
    }
    const quote = this.buildDpoIncomingQuote(dto.amount, currency);
    const requireProvisioning =
      String(
        this.configService.get<string>('ROI_REQUIRE_ONCHAIN_PROVISIONING') ??
          'true',
      ).toLowerCase() !== 'false';
    const nftMintingEnabled =
      String(
        this.configService.get<string>('ROI_DISABLE_NFT_MINTING') ?? 'false',
      ).toLowerCase() !== 'true';

    return {
      projectId: dto.projectId,
      projectType,
      projectName: project.name || 'project',
      currency,
      requestedAmount: quote.requestedAmount,
      grossAmount: quote.grossAmount,
      dpoFee: quote.dpoFee,
      dpoVat: quote.dpoVat,
      keiboFee: quote.keiboFee,
      providerNetAmount: quote.providerNetAmount,
      projectNetAmount: quote.projectNetAmount,
      roundingAdjustment: quote.roundingAdjustment,
      // ROI testing-mode flags — frontend uses these to show bypass-mode info banner
      roi:
        projectType !== 'CHARITY'
          ? { bypassActive: !requireProvisioning, nftMintingEnabled }
          : undefined,
    };
  }

  async creditTreasuryInboundFee(currency: string, amount: number) {
    const treasuryUserId = this.configService.get<string>(
      'KEIBO_TREASURY_USER_ID',
    );
    const normalizedAmount = Number(amount || 0);
    if (!treasuryUserId || normalizedAmount <= 0) {
      return false;
    }

    const treasuryWallet = await this.getOrCreateWallet(treasuryUserId);
    this.setFiatBalance(
      treasuryWallet.fiatBalance,
      currency,
      this.getFiatBalance(treasuryWallet.fiatBalance, currency) +
        normalizedAmount,
    );
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
    const expectedCompanyRef = this.stringValue(metadata.companyRef).trim();
    const expectedCurrency = transaction.currency.toUpperCase();
    const expectedGrossAmount = Number(
      (typeof quote.grossAmount === 'number'
        ? quote.grossAmount
        : transaction.amount) || 0,
    );
    const expectedProviderNetAmount = Number(
      typeof quote.providerNetAmount === 'number'
        ? quote.providerNetAmount
        : typeof quote.projectNetAmount === 'number'
          ? quote.projectNetAmount
          : 0,
    );

    if (
      expectedCompanyRef &&
      verify.companyRef &&
      verify.companyRef !== expectedCompanyRef
    ) {
      return { ok: false, reason: 'DPO company reference mismatch' };
    }

    if (verify.currency && verify.currency.toUpperCase() !== expectedCurrency) {
      return { ok: false, reason: 'DPO currency mismatch' };
    }

    if (
      !amountsMatch({
        expected: expectedGrossAmount,
        actual: parseProviderAmount(verify.amount),
        currency: expectedCurrency,
      })
    ) {
      return { ok: false, reason: 'DPO charged amount mismatch' };
    }

    const actualProviderNetAmount = parseProviderAmount(verify.netAmount);
    const hasUsableProviderNetAmount =
      actualProviderNetAmount !== null && actualProviderNetAmount > 0;
    if (
      expectedProviderNetAmount > 0 &&
      hasUsableProviderNetAmount &&
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
    emitSuccessEvent: boolean = true,
  ) {
    const mergedWebhookData = {
      ...(sourcePayload || {}),
      verify,
    };
    const disposition = normalizeDpoResult(verify.status);

    if (disposition.paymentStatus === PaymentStatus.Successful) {
      const settlementCheck = this.verifyDpoSettlementData(transaction, verify);
      if (!settlementCheck.ok) {
        this.logger.error(
          `DPO settlement verification failed: reason=${settlementCheck.reason || 'unknown'} providerStatus=${verify.status}`,
        );
        await this.markTransactionFailedIfUnsettled(
          String(transaction._id),
          settlementCheck.reason || 'DPO settlement verification failed',
          mergedWebhookData,
        );
        return PaymentStatus.Failed;
      }

      if (!verify.companyRef || Number(verify.netAmount || 0) <= 0) {
        this.logger.warn(
          'DPO settlement fields incomplete but payment is marked successful',
        );
      }

      const changed = await this.markTransactionSuccessful(
        String(transaction._id),
        mergedWebhookData,
      );

      if (changed && emitSuccessEvent) {
        const metadata = this.asRecord(transaction.metadata);
        this.eventEmitter.emit('payment.successful', {
          transactionId: transaction._id,
          userId: transaction.userId,
          projectId: transaction.projectId,
          amount: transaction.amount,
          currency: transaction.currency,
          projectType: metadata?.projectType,
          walletAddress: metadata?.walletAddress,
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

  private getProviderTransferId(payload: unknown): string | undefined {
    const root = this.asRecord(payload);
    const data = this.asRecord(root?.data);
    const nestedData = this.asRecord(data?.data);
    const rawId =
      data?.id ??
      nestedData?.id ??
      data?.transfer_id ??
      root?.transfer_id ??
      root?.id;

    if (rawId === undefined || rawId === null) {
      return undefined;
    }

    return this.stringValue(rawId) || undefined;
  }

  private getProviderTransferStatus(payload: unknown): string {
    const root = this.asRecord(payload);
    const data = this.asRecord(root?.data);
    const nestedData = this.asRecord(data?.data);

    return this.stringValue(data?.status ?? nestedData?.status ?? root?.status)
      .trim()
      .toLowerCase();
  }

  private assertPayoutWasAccepted(payload: unknown, reference: string) {
    const root = this.asRecord(payload);
    const data = this.asRecord(root?.data);
    const providerStatus = this.getProviderTransferStatus(payload);
    const topLevelStatus = this.stringValue(root?.status).trim().toLowerCase();
    const failedStatuses = new Set([
      'failed',
      'error',
      'cancelled',
      'canceled',
      'reversed',
    ]);

    if (
      failedStatuses.has(providerStatus) ||
      failedStatuses.has(topLevelStatus)
    ) {
      const rawReason =
        data?.complete_message ||
        data?.message ||
        root?.message ||
        'Provider rejected payout request';
      const reason =
        this.stringValue(rawReason) || 'Provider rejected payout request';
      this.logger.error(
        `Payout rejected before wallet debit: reference=${reference}, status=${providerStatus || topLevelStatus}, reason=${reason}`,
      );
      throw new BadRequestException(`Payout failed: ${reason}`);
    }
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
    const metadata = this.asRecord(transaction.metadata);
    const providerTransferId = this.stringValue(
      metadata?.payoutTransferId || this.getProviderTransferId(payload) || '',
    ).trim();

    if (!providerTransferId) {
      if (transaction.flutterwaveReference) {
        this.logger.warn(
          `Payout ${transaction.flutterwaveReference} has no provider transfer id; keeping it processing until callback supplies one.`,
        );
        return {
          normalizedStatus: '',
          providerData: payload,
        };
      }

      const payloadData = this.asRecord(payload);
      const nestedData = this.asRecord(payloadData?.data);
      return {
        normalizedStatus: this.stringValue(
          nestedData?.status || payloadData?.status,
        ).toLowerCase(),
        providerData: payload,
      };
    }

    const providerResponse =
      await this.flutterwaveService.getTransfer(providerTransferId);
    const providerData =
      this.asRecord(providerResponse.data) ?? providerResponse;
    const providerReference = this.stringValue(
      providerData.reference ||
        providerData?.tx_ref ||
        providerData?.txRef ||
        '',
    ).trim();

    if (
      providerReference &&
      providerReference !== transaction.flutterwaveReference
    ) {
      throw new ForbiddenException('Payout callback reference mismatch');
    }

    return {
      normalizedStatus: this.stringValue(providerData.status).toLowerCase(),
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
          const { normalizedStatus, providerData } =
            await this.confirmPayoutState(transaction);
          if (
            ['successful', 'success', 'completed'].includes(normalizedStatus)
          ) {
            const changed = await this.markTransactionSuccessful(
              String(transaction._id),
              providerData,
            );
            if (changed) {
              await this.sendWithdrawalEmail(String(transaction.userId), {
                subject: 'Withdrawal completed',
                body: `Your withdrawal of ${this.formatAmount(transaction.currency, Math.abs(transaction.amount))} has been completed successfully.`,
              });
            }
            continue;
          }

          if (
            ['failed', 'error', 'cancelled', 'reversed'].includes(
              normalizedStatus,
            )
          ) {
            await this.refundFailedWithdrawal(
              transaction,
              this.stringValue(
                providerData?.complete_message || providerData?.message,
              ) || 'Payout failed',
              providerData,
            );
          }
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : 'Unknown error';
          this.logger.warn(
            `Failed payout reconciliation for ${transaction.flutterwaveReference}: ${message}`,
          );
        }
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Payout reconciliation loop failed: ${message}`);
    }
  }

  /**
   * Initialize a payment for investment
   */
  async initializePayment(dto: InitializePaymentDto, userId: string) {
    // Generate unique transaction reference
    const txRef = `INV-${Date.now()}-${randomUUID()}`;

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
    const responseData = this.asRecord(flwResponse.data);
    const responseMeta = this.asRecord(flwResponse.meta);
    const authorization = this.asRecord(responseMeta?.authorization);
    transaction.flutterwavePaymentLink =
      this.stringValue(responseData?.link) ||
      this.stringValue(authorization?.redirect) ||
      undefined;
    transaction.metadata = {
      ...transaction.metadata,
      flutterwaveResponse: flwResponse,
    };
    await transaction.save();

    this.logger.log(
      `Payment initialized for user ${userId}: ${String(transaction._id)}`,
    );

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
    const responseData = this.asRecord(flwResponse.data);
    const providerStatus = this.stringValue(responseData?.status);
    if (providerStatus === 'successful') {
      transaction.flutterwaveTransactionId = this.stringValue(responseData?.id);
      transaction.webhookData = responseData;
      await transaction.save();

      const changed = await this.markTransactionSuccessful(
        String(transaction._id),
        responseData,
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
    } else if (providerStatus === 'failed') {
      transaction.status = PaymentStatus.Failed;
      transaction.failureReason =
        this.stringValue(responseData?.processor_response) || 'Payment failed';
      await transaction.save();
    }

    return {
      status:
        providerStatus === 'successful'
          ? PaymentStatus.Successful
          : transaction.status,
      transaction:
        (await this.paymentTransactionModel.findById(transaction._id).lean()) ||
        transaction.toObject(),
    };
  }

  /**
   * Handle Flutterwave webhook
   */
  handleWebhook(signature: string, payload: unknown) {
    void signature;
    void payload;
    throw new BadRequestException(
      'Legacy Flutterwave webhook mutation is disabled; use the verified financial adapter endpoint',
    );
  }

  async handlePayoutCallback(
    payload: Record<string, unknown>,
    signature?: string,
  ) {
    if (
      !signature ||
      !this.flutterwaveService.verifyWebhookSignature(signature, payload)
    ) {
      throw new ForbiddenException('Invalid payout callback signature');
    }

    const data = this.asRecord(payload.data) ?? payload;
    const reference = this.stringValue(
      data.reference || data.tx_ref || data.txRef,
    );

    if (!reference) {
      this.logger.warn('Payout callback received without reference');
      return { received: true };
    }

    const transaction = await this.paymentTransactionModel.findOne({
      flutterwaveReference: reference,
    });

    if (!transaction) {
      this.logger.warn(
        `Payout callback received for unknown transfer reference: ${reference}`,
      );
      return { received: true };
    }

    const { normalizedStatus, providerData } = await this.confirmPayoutState(
      transaction,
      payload,
    );

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
      const changed = await this.markTransactionSuccessful(
        String(transaction._id),
        providerData || payload,
      );
      if (changed) {
        await this.sendWithdrawalEmail(String(transaction.userId), {
          subject: 'Withdrawal completed',
          body: `Your withdrawal of ${this.formatAmount(transaction.currency, Math.abs(transaction.amount))} has been completed successfully.`,
        });
      }
      this.logger.log(`Payout marked successful: ${reference}`);
      return { received: true };
    }

    if (
      ['failed', 'error', 'cancelled', 'reversed'].includes(normalizedStatus)
    ) {
      await this.refundFailedWithdrawal(
        transaction,
        this.stringValue(
          providerData?.complete_message ||
            providerData?.message ||
            data.message ||
            data.complete_message,
        ) || 'Payout failed',
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
    let wallet = await this.walletModel.findOne({
      userId: new Types.ObjectId(userId),
    });

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

  async applySuccessfulCharityPayment(params: {
    transactionId: string;
    projectId: string;
    amount: number;
    currency: string;
    userId?: string;
    donorName?: string;
    inboundKeiboFee?: number;
  }): Promise<{
    applied: boolean;
    creatorId?: string;
    projectName: string;
    creatorWalletCredited: boolean;
  }> {
    const transactionObjectId = new Types.ObjectId(params.transactionId);
    const projectObjectId = new Types.ObjectId(params.projectId);
    const currency = params.currency.toUpperCase();
    const session = await this.connection.startSession();

    try {
      const result = await session.withTransaction(async () => {
        const lockResult = await this.paymentTransactionModel.updateOne(
          {
            _id: transactionObjectId,
            'metadata.applicationAppliedAt': { $exists: false },
          },
          {
            $set: {
              'metadata.applicationApplyingAt': new Date(),
            },
          },
          { session },
        );

        const transaction = await this.paymentTransactionModel
          .findById(transactionObjectId)
          .session(session);

        if (!transaction) {
          throw new NotFoundException('Payment transaction not found');
        }

        const project = await this.projectModel
          .findById(projectObjectId)
          .session(session);

        if (!project) {
          throw new NotFoundException('Project not found');
        }

        const projectType = this.normalizeProjectType(
          (project as { projectType?: unknown; type?: unknown }).projectType ??
            (project as { type?: unknown }).type,
        );
        if (projectType !== 'CHARITY') {
          throw new BadRequestException(
            'Only charity payments can use charity settlement',
          );
        }

        const creatorId = this.extractObjectId(
          (project as { creatorId?: unknown }).creatorId,
        );
        if (!creatorId) {
          throw new BadRequestException(
            'Charity project creator could not be resolved',
          );
        }

        const projectName = project.name || 'project';

        if (lockResult.modifiedCount === 0) {
          return {
            applied: false,
            creatorId,
            projectName,
            creatorWalletCredited: Boolean(
              transaction.metadata?.applicationWalletCredited,
            ),
          };
        }

        const donorName = (params.donorName ?? '').trim() || 'Anonymous';
        await this.charityDonationModel.create(
          [
            {
              projectId: projectObjectId,
              amount: params.amount,
              donorName,
              userId: params.userId
                ? new Types.ObjectId(params.userId)
                : undefined,
              transactionId: transactionObjectId,
            },
          ],
          { session },
        );

        await this.projectModel.updateOne(
          { _id: projectObjectId },
          { $inc: { raisedAmount: params.amount, backerCount: 1 } },
          { session },
        );

        await this.walletModel.updateOne(
          { userId: new Types.ObjectId(creatorId) },
          {
            $setOnInsert: {
              userId: new Types.ObjectId(creatorId),
              cryptoBalance: { ETH: 0, USDC: 0 },
              roiBalance: { UGX: 0, USD: 0 },
              withdrawalMethods: [],
              transactions: [],
            },
            $inc: {
              [`fiatBalance.${currency}`]: params.amount,
            },
          },
          { upsert: true, session },
        );

        const inboundKeiboFee = Number(params.inboundKeiboFee || 0);
        const treasuryUserId = this.configService.get<string>(
          'KEIBO_TREASURY_USER_ID',
        );
        if (treasuryUserId && inboundKeiboFee > 0) {
          await this.walletModel.updateOne(
            { userId: new Types.ObjectId(treasuryUserId) },
            {
              $setOnInsert: {
                userId: new Types.ObjectId(treasuryUserId),
                cryptoBalance: { ETH: 0, USDC: 0 },
                roiBalance: { UGX: 0, USD: 0 },
                withdrawalMethods: [],
                transactions: [],
              },
              $inc: {
                [`fiatBalance.${currency}`]: inboundKeiboFee,
              },
            },
            { upsert: true, session },
          );
        }

        await this.paymentTransactionModel.updateOne(
          { _id: transactionObjectId },
          {
            $set: {
              'metadata.applicationAppliedAt': new Date(),
              'metadata.applicationProjectType': 'CHARITY',
              'metadata.applicationWalletCredited': true,
              'metadata.applicationTreasuryFeeCredited': inboundKeiboFee > 0,
            },
            $unset: {
              'metadata.applicationApplyingAt': 1,
            },
          },
          { session },
        );

        return {
          applied: true,
          creatorId,
          projectName,
          creatorWalletCredited: true,
        };
      });

      return (
        result ?? {
          applied: false,
          projectName: 'project',
          creatorWalletCredited: false,
        }
      );
    } finally {
      await session.endSession();
    }
  }

  /**
   * Deposit to wallet via Flutterwave
   */
  depositToWallet(dto: DepositToWalletDto, userId: string, email: string) {
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
  processWalletInvestment(dto: WalletInvestmentDto, userId: string) {
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
      throw new ForbiddenException(
        'ROI withdrawals are restricted for this account',
      );
    }

    const balance = this.getFiatBalance(
      isRoi ? wallet.roiBalance : wallet.fiatBalance,
      currency,
    );

    if (balance < dto.amount) {
      throw new BadRequestException(
        `Insufficient ${isRoi ? 'ROI' : 'Charity'} ${currency} balance`,
      );
    }

    // Validate amount based on type
    if (!isRoi && dto.amount < 500) {
      throw new BadRequestException('Minimum charity withdrawal is UGX 500');
    }

    if (isRoi && dto.projectId) {
      const project = await this.walletModel.db
        .collection('projects')
        .findOne({ _id: new Types.ObjectId(dto.projectId) });
      if (!project) throw new BadRequestException('Project not found');
      const targetAmount =
        this.numberValue(project.goalAmount) ||
        this.numberValue(project.targetAmount, 1);
      if (this.numberValue(project.raisedAmount) < targetAmount) {
        throw new BadRequestException(
          'ROI investments can only be withdrawn once the project hits 100% of its target',
        );
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
    const payoutRef = `PAYOUT-${Date.now()}-${randomUUID()}`;

    if (isRoi) {
      // Deduct requested amount from creator's ROI wallet
      this.setFiatBalance(wallet.roiBalance, currency, balance - dto.amount);
      wallet.markModified('roiBalance');
      await wallet.save();

      // Create pending transaction record
      const transaction = await this.paymentTransactionModel.create({
        userId: new Types.ObjectId(userId),
        projectId: new Types.ObjectId(
          dto.projectId || '000000000000000000000000',
        ),
        amount: -dto.amount, // Negative for withdrawal
        currency: dto.currency,
        paymentMethod:
          method.type === WithdrawalMethodType.MobileMoney
            ? PaymentMethod.MobileMoney
            : PaymentMethod.BankTransfer,
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

      this.logger.log(
        `ROI Withdrawal initiated for user ${userId}: ${String(transaction._id)}. Awaiting admin approval.`,
      );

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
        message:
          'ROI withdrawal request received. Funds are reserved and now awaiting administrator approval.',
      };
    }

    const treasuryUserId = this.configService.get<string>(
      'KEIBO_TREASURY_USER_ID',
    );
    const charityWithdrawalSession = await this.connection.startSession();
    let transaction!: PaymentTransactionDocument;

    try {
      transaction = await charityWithdrawalSession.withTransaction(async () => {
        const debitResult = await this.walletModel.updateOne(
          {
            userId: new Types.ObjectId(userId),
            [`fiatBalance.${currency}`]: { $gte: dto.amount },
          },
          {
            $inc: {
              [`fiatBalance.${currency}`]: -dto.amount,
            },
          },
          { session: charityWithdrawalSession },
        );

        if (debitResult.modifiedCount !== 1) {
          throw new BadRequestException(
            `Insufficient Charity ${currency} balance`,
          );
        }

        if (treasuryUserId && platformFee > 0) {
          await this.walletModel.updateOne(
            { userId: new Types.ObjectId(treasuryUserId) },
            {
              $setOnInsert: {
                userId: new Types.ObjectId(treasuryUserId),
                cryptoBalance: { ETH: 0, USDC: 0 },
                roiBalance: { UGX: 0, USD: 0 },
                withdrawalMethods: [],
                transactions: [],
              },
              $inc: {
                [`fiatBalance.${currency}`]: platformFee,
              },
            },
            { upsert: true, session: charityWithdrawalSession },
          );
        }

        const created = await this.paymentTransactionModel.create(
          [
            {
              userId: new Types.ObjectId(userId),
              projectId: new Types.ObjectId(
                dto.projectId || '000000000000000000000000',
              ),
              amount: -dto.amount,
              currency: dto.currency,
              paymentMethod:
                method.type === WithdrawalMethodType.MobileMoney
                  ? PaymentMethod.MobileMoney
                  : PaymentMethod.BankTransfer,
              provider: PaymentProvider.Flutterwave,
              status: PaymentStatus.Processing,
              flutterwaveReference: payoutRef,
              metadata: {
                type: 'WITHDRAWAL_CHARITY',
                providerDispatchStatus: 'reserved',
                platformFee,
                payoutAmount,
                feeRate: PLATFORM_FEE_RATE,
                method,
              },
            },
          ],
          { session: charityWithdrawalSession },
        );

        return created[0];
      });
    } finally {
      await charityWithdrawalSession.endSession();
    }

    let payoutResult: Record<string, unknown>;
    try {
      payoutResult = await this.flutterwaveService.processPayout({
        amount: payoutAmount,
        currency: dto.currency,
        accountNumber: method.accountNumber,
        accountBank: method.provider,
        narration: dto.note || 'Wallet withdrawal - Keibo',
        reference: payoutRef,
        beneficiaryName: method.accountName,
        mobileNumber: method.accountNumber,
      });
      this.assertPayoutWasAccepted(payoutResult, payoutRef);
    } catch (payoutError: unknown) {
      const payoutMessage =
        payoutError instanceof Error
          ? payoutError.message
          : 'Payout dispatch failed';
      const persistedTransaction = await this.paymentTransactionModel.findById(
        transaction._id,
      );
      if (persistedTransaction) {
        await this.refundFailedWithdrawal(persistedTransaction, payoutMessage, {
          dispatchError: payoutMessage,
        });
      }
      throw payoutError;
    }

    const payoutTransferId = this.getProviderTransferId(payoutResult) ?? null;
    const payoutProviderStatus = this.getProviderTransferStatus(payoutResult);
    const payoutIsImmediatelySuccessful = [
      'successful',
      'success',
      'completed',
    ].includes(payoutProviderStatus);

    await this.paymentTransactionModel.updateOne(
      { _id: transaction._id },
      {
        $set: {
          status: payoutIsImmediatelySuccessful
            ? PaymentStatus.Successful
            : PaymentStatus.Processing,
          ...(payoutIsImmediatelySuccessful ? { completedAt: new Date() } : {}),
          'metadata.providerDispatchStatus': 'accepted',
          'metadata.payoutResult': payoutResult,
          'metadata.payoutTransferId': payoutTransferId,
          'metadata.payoutProviderStatus': payoutProviderStatus || 'processing',
        },
      },
    );

    const refreshedTransaction = await this.paymentTransactionModel.findById(
      transaction._id,
    );
    if (refreshedTransaction) {
      transaction = refreshedTransaction;
    }
    const refreshedWallet = await this.walletModel.findOne({
      userId: new Types.ObjectId(userId),
    });
    const newBalance = refreshedWallet
      ? this.getFiatBalance(refreshedWallet.fiatBalance, currency)
      : 0;

    this.logger.log(`Charity Withdrawal processed for user ${userId}`);

    await this.sendWithdrawalEmail(
      userId,
      payoutIsImmediatelySuccessful
        ? {
            subject: 'Withdrawal completed',
            body: `Your withdrawal of ${this.formatAmount(currency, dto.amount)} has been completed successfully.`,
          }
        : {
            subject: 'Withdrawal request submitted',
            body: `Your withdrawal of ${this.formatAmount(currency, dto.amount)} has been submitted to Flutterwave and is awaiting Mobile Money delivery confirmation. We will notify you again after the provider confirms completion.`,
          },
    );

    return {
      transactionId: transaction._id,
      status: transaction.status,
      amount: dto.amount,
      platformFee,
      youReceive: payoutAmount,
      providerReference: payoutRef,
      providerTransferId: payoutTransferId,
      providerStatus:
        payoutProviderStatus ||
        this.stringValue(payoutResult.status) ||
        'processing',
      message: payoutIsImmediatelySuccessful
        ? 'Withdrawal completed successfully.'
        : 'Withdrawal request submitted to Flutterwave. Mobile Money delivery is still awaiting provider confirmation.',
      newBalance,
    };
  }

  async approveRoiWithdrawal(transactionId: string) {
    const transaction =
      await this.paymentTransactionModel.findById(transactionId);
    if (!transaction || transaction.status !== PaymentStatus.Pending) {
      throw new BadRequestException(
        'Invalid transaction or not pending approval',
      );
    }

    const payoutRef = `PAYOUT-ROI-${Date.now()}`;
    const metadata = this.asRecord(transaction.metadata);
    const method = this.asRecord(metadata?.method);
    const payoutAmount = this.numberValue(metadata?.payoutAmount);
    const platformFee = this.numberValue(metadata?.platformFee);
    const accountNumber = this.stringValue(method?.accountNumber);
    const accountBank = this.stringValue(method?.provider);
    if (
      !metadata ||
      !method ||
      payoutAmount <= 0 ||
      !accountNumber ||
      !accountBank
    ) {
      throw new BadRequestException('Withdrawal payout metadata is invalid');
    }
    const payoutResult = await this.flutterwaveService.processPayout({
      amount: payoutAmount,
      currency: transaction.currency,
      accountNumber,
      accountBank,
      narration:
        this.stringValue(metadata.note) || 'ROI Wallet withdrawal - Keibo',
      reference: payoutRef,
      beneficiaryName: this.stringValue(method.accountName) || undefined,
      mobileNumber: accountNumber,
    });
    this.assertPayoutWasAccepted(payoutResult, payoutRef);

    const currency = transaction.currency;
    const treasuryUserId = this.configService.get<string>(
      'KEIBO_TREASURY_USER_ID',
    );
    if (treasuryUserId && platformFee > 0) {
      try {
        const treasuryWallet = await this.getOrCreateWallet(treasuryUserId);
        this.setFiatBalance(
          treasuryWallet.fiatBalance,
          currency,
          this.getFiatBalance(treasuryWallet.fiatBalance, currency) +
            platformFee,
        );
        treasuryWallet.markModified('fiatBalance');
        await treasuryWallet.save();
      } catch (feeError: unknown) {
        const message =
          feeError instanceof Error ? feeError.message : 'Unknown error';
        this.logger.warn(
          `Failed to credit treasury fee for approved ROI payout: ${message}`,
        );
      }
    }

    const payoutProviderStatus = this.getProviderTransferStatus(payoutResult);
    const payoutIsImmediatelySuccessful = [
      'successful',
      'success',
      'completed',
    ].includes(payoutProviderStatus);
    transaction.status = payoutIsImmediatelySuccessful
      ? PaymentStatus.Successful
      : PaymentStatus.Processing;
    if (payoutIsImmediatelySuccessful) {
      transaction.completedAt = new Date();
    }
    transaction.flutterwaveReference = payoutRef;
    transaction.metadata = {
      ...metadata,
      payoutResult,
      payoutTransferId: this.getProviderTransferId(payoutResult) ?? null,
      payoutProviderStatus: payoutProviderStatus || 'processing',
      pendingApproval: false,
    };
    transaction.markModified('metadata');
    await transaction.save();

    await this.sendWithdrawalEmail(
      String(transaction.userId),
      payoutIsImmediatelySuccessful
        ? {
            subject: 'ROI withdrawal completed',
            body: `Your ROI withdrawal of ${this.formatAmount(transaction.currency, Math.abs(transaction.amount))} has been completed successfully.`,
          }
        : {
            subject: 'ROI withdrawal approved',
            body: `Your ROI withdrawal of ${this.formatAmount(transaction.currency, Math.abs(transaction.amount))} has been approved and submitted to Flutterwave. Mobile Money delivery is still awaiting provider confirmation.`,
          },
    );

    return { success: true, message: 'Payout approved and processing' };
  }

  async rejectRoiWithdrawal(transactionId: string) {
    const transaction =
      await this.paymentTransactionModel.findById(transactionId);
    if (!transaction || transaction.status !== PaymentStatus.Pending) {
      throw new BadRequestException(
        'Invalid transaction or not pending approval',
      );
    }

    // Refund the user's roiBalance
    const wallet = await this.getOrCreateWallet(transaction.userId.toString());
    this.setFiatBalance(
      wallet.roiBalance,
      transaction.currency,
      this.getFiatBalance(wallet.roiBalance, transaction.currency) +
        Math.abs(transaction.amount),
    );
    wallet.markModified('roiBalance');
    await wallet.save();

    transaction.status = PaymentStatus.Failed;
    transaction.metadata = {
      ...(this.asRecord(transaction.metadata) ?? {}),
      pendingApproval: false,
      rejectReason: 'Rejected by administrator',
    };
    transaction.markModified('metadata');
    await transaction.save();

    await this.sendWithdrawalEmail(String(transaction.userId), {
      subject: 'ROI withdrawal rejected',
      body: `Your ROI withdrawal of ${this.formatAmount(transaction.currency, Math.abs(transaction.amount))} was rejected and the full amount has been returned to your wallet.`,
    });

    return { success: true, message: 'Payout rejected and refunded' };
  }

  async getPendingWithdrawals() {
    const transactions = await this.paymentTransactionModel
      .find({
        status: PaymentStatus.Pending,
        'metadata.type': 'WITHDRAWAL_ROI',
      })
      .populate('userId', 'firstName lastName email')
      .populate('projectId', 'name')
      .sort({ createdAt: -1 });
    return transactions;
  }

  private async refundFailedWithdrawal(
    transaction: PaymentTransactionDocument,
    reason: string,
    providerData?: Record<string, unknown>,
  ) {
    if (
      transaction.status === PaymentStatus.Failed ||
      transaction.metadata?.refundApplied
    ) {
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
      this.setFiatBalance(
        wallet.roiBalance,
        currency,
        this.getFiatBalance(wallet.roiBalance, currency) + absoluteAmount,
      );
      wallet.markModified('roiBalance');
    } else {
      this.setFiatBalance(
        wallet.fiatBalance,
        currency,
        this.getFiatBalance(wallet.fiatBalance, currency) + absoluteAmount,
      );
      wallet.markModified('fiatBalance');
    }
    await wallet.save();

    const treasuryUserId = this.configService.get<string>(
      'KEIBO_TREASURY_USER_ID',
    );
    if (treasuryUserId && platformFee > 0) {
      try {
        const treasuryWallet = await this.getOrCreateWallet(treasuryUserId);
        const currentTreasuryBalance = Number(
          this.getFiatBalance(treasuryWallet.fiatBalance, currency),
        );
        this.setFiatBalance(
          treasuryWallet.fiatBalance,
          currency,
          Math.max(0, currentTreasuryBalance - platformFee),
        );
        treasuryWallet.markModified('fiatBalance');
        await treasuryWallet.save();
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : 'Unknown error';
        this.logger.warn(
          `Failed to reverse treasury fee for refund: ${message}`,
        );
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
      paymentIntentId: string;
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
    if (!userId) {
      throw new ForbiddenException(
        'Sign in is required for ledger-backed payment processing',
      );
    }
    const backendUrl = (this.configService.get<string>('BACKEND_URL') ?? '')
      .trim()
      .replace(/[,\s]+$/, '')
      .replace(/\/+$/, '');
    const frontendUrl = (this.configService.get<string>('FRONTEND_URL') ?? '')
      .trim()
      .replace(/[,\s]+$/, '')
      .replace(/\/+$/, '');
    if (!backendUrl) {
      throw new BadRequestException(
        'BACKEND_URL is required for DPO payment callbacks',
      );
    }
    const { project, projectType } = await this.resolveCheckoutProject(
      dto.projectId,
    );
    const isCharity = projectType === 'CHARITY';

    if (
      !isCharity &&
      userId &&
      !hasBackendRoiAccess(userId, this.configService)
    ) {
      throw new ForbiddenException('ROI access is restricted for this account');
    }

    if (isCharity) {
      await this.projectsService.ensureProjectCanReceiveDonation(dto.projectId);
    } else {
      await this.projectsService.ensureProjectIsOpenForInvestment(
        dto.projectId,
      );
      const requireProvisioning =
        String(
          this.configService.get<string>('ROI_REQUIRE_ONCHAIN_PROVISIONING') ??
            'true',
        ).toLowerCase() !== 'false';
      const rawOnchainId = project.projectOnchainId?.trim() ?? '';
      const isProvisioned = rawOnchainId.length > 0 && rawOnchainId !== '0';
      if (requireProvisioning && !isProvisioned) {
        throw new BadRequestException(
          'ROI checkout is unavailable until this project has been provisioned on-chain.',
        );
      }
    }

    const normalizedWalletAddress =
      dto.walletAddress?.trim().toLowerCase() || '';
    if (!isCharity && !normalizedWalletAddress) {
      throw new BadRequestException(
        'Wallet address is required for ROI investments.',
      );
    }

    const currency = (dto.currency ?? 'UGX').toUpperCase();
    const quote = this.buildDpoIncomingQuote(dto.amount, currency);
    await this.financialService.assertIntentForCheckout({
      id: dto.paymentIntentId,
      contributorId: userId,
      projectId: dto.projectId,
      amountMinor: decimalToMinor(quote.grossAmount, currency),
      currency,
    });
    const description =
      dto.description ??
      (isCharity
        ? `Donation to ${project.name || 'charity project'} - Keibo`
        : `Investment in ${project.name || 'ROI project'} - Keibo`);
    // RedirectURL: user lands here after paying on DPO hosted page (card success path).
    // DPO appends ?ID=<token>&CCDapproval=&PnrID=&TransactionApproval= etc.
    const redirectUrl = `${frontendUrl}/payment/result?projectId=${dto.projectId}&paymentIntentId=${dto.paymentIntentId}`;
    // BackURL: DPO server-to-server IPN (POST) on cancel, and user redirect for mobile-money cancel.
    // Use separate endpoint so we can handle both cases cleanly.
    const backUrl = `${backendUrl}/api/payments/dpo/webhook`;

    const txRef = `DPO-${Date.now()}-${randomUUID()}`;
    const companyRef = `KEIBO-${dto.projectId}-${Date.now()}`;
    const token = (
      await this.dpoService.createToken(
        dto.projectId,
        quote.grossAmount,
        currency,
        backUrl,
        redirectUrl,
        description,
        companyRef,
      )
    ).token;

    const requireProvisioning =
      String(
        this.configService.get<string>('ROI_REQUIRE_ONCHAIN_PROVISIONING') ??
          'true',
      ).toLowerCase() !== 'false';
    const disableNftMinting =
      String(
        this.configService.get<string>('ROI_DISABLE_NFT_MINTING') ?? 'false',
      ).toLowerCase() === 'true';
    const roiOnchainId = project.projectOnchainId?.trim() ?? '';
    const isProvisioned = roiOnchainId.length > 0 && roiOnchainId !== '0';
    const provisioningBypassed =
      !isCharity && !requireProvisioning && !isProvisioned;

    await this.paymentTransactionModel.create({
      ...(userId ? { userId: new Types.ObjectId(userId) } : {}),
      projectId: new Types.ObjectId(dto.projectId),
      amount: quote.requestedAmount,
      currency,
      paymentMethod: dto.paymentMethod,
      provider: PaymentProvider.DPO,
      dpoToken: token,
      flutterwaveReference: txRef,
      phoneNumber: dto.phoneNumber,
      status: PaymentStatus.Pending,
      metadata: {
        projectType,
        description,
        donorName: dto.donorName,
        projectId: dto.projectId,
        walletAddress: normalizedWalletAddress || null,
        projectName: project.name || null,
        companyRef,
        dpoQuote: quote,
        paymentIntentId: dto.paymentIntentId,
        // Explicit bypass markers — marketplace/NFT logic MUST check these
        provisioningBypassed,
        nftMintingDisabled: disableNftMinting,
      },
    });

    this.logger.log('DPO payment session created');

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
  async verifyDPOPayment(token: string, requestingUserId?: string) {
    const transaction = await this.paymentTransactionModel.findOne({
      dpoToken: token,
    });
    if (!transaction) throw new NotFoundException('DPO transaction not found');
    if (
      requestingUserId &&
      transaction.userId?.toString() !== requestingUserId
    ) {
      throw new ForbiddenException(
        'Payment intent does not belong to this user',
      );
    }

    const verify = await this.dpoService.verifyToken(token);
    this.logger.log(
      `DPO payment verification completed with provider status ${verify.status}`,
    );
    const rawPaymentIntentId = (
      transaction.metadata as Record<string, unknown> | undefined
    )?.paymentIntentId;
    const paymentIntentId =
      typeof rawPaymentIntentId === 'string' ? rawPaymentIntentId : '';
    if (!paymentIntentId) {
      throw new BadRequestException(
        'Legacy payment has no authoritative financial intent',
      );
    }
    if (verify.status === '000') {
      await this.financialService.acceptProviderEvent(
        this.dpoFinancialAdapter.fromVerifiedToken({
          token,
          paymentIntentId,
          evidence: verify,
        }),
      );
    }
    const contributorId = transaction.userId?.toString();
    if (!contributorId) {
      throw new BadRequestException('Payment has no authenticated contributor');
    }
    const intent = await this.financialService.getPaymentIntent(
      paymentIntentId,
      contributorId,
    );
    return {
      status: intent.state,
      paymentIntentId,
      verify,
    };
  }

  async repairDPOPaymentByToken(token: string) {
    return this.verifyDPOPayment(token);
  }

  /**
   * Handle DPO server-to-server webhook / BackURL callback.
   */
  async handleDPOWebhook(payload: Record<string, string>) {
    const token = payload.TransactionToken ?? payload.token;
    if (!token) return { received: true };
    const result = await this.verifyDPOPayment(token);
    return { received: true, status: result.status };
  }
}
