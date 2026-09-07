import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import crypto from 'crypto';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import axios from 'axios';
import { firstValueFrom } from 'rxjs';
import { InitializePaymentDto } from './dto/initialize-payment.dto';
import {
  PaymentMethod,
  MobileMoneyProvider,
} from './schemas/payment-transaction.schema';

type ProviderResponse = Record<string, unknown>;

function providerError(error: unknown): { message: string; stack?: string } {
  if (axios.isAxiosError(error)) {
    const data =
      error.response?.data && typeof error.response.data === 'object'
        ? (error.response.data as Record<string, unknown>)
        : undefined;
    const message = data?.message ?? data?.error;
    return {
      message: typeof message === 'string' ? message : error.message,
      stack: error.stack,
    };
  }
  return error instanceof Error
    ? { message: error.message, stack: error.stack }
    : { message: 'Unknown provider error' };
}

@Injectable()
export class FlutterwaveService {
  private readonly logger = new Logger(FlutterwaveService.name);
  private readonly baseUrl = 'https://api.flutterwave.com/v3';
  private secretKey: string;
  private publicKey: string;

  constructor(
    private configService: ConfigService,
    private httpService: HttpService,
  ) {
    this.publicKey =
      this.configService.get<string>('FLUTTERWAVE_PUBLIC_KEY') || '';
    this.secretKey =
      this.configService.get<string>('FLUTTERWAVE_SECRET_KEY') || '';

    if (!this.publicKey || !this.secretKey) {
      this.logger.warn(
        'Flutterwave keys not configured. Payment features will be disabled.',
      );
    } else {
      this.logger.log('Flutterwave service initialized');
    }
  }

  private getBackendUrl(): string {
    return (this.configService.get<string>('BACKEND_URL') || '')
      .trim()
      .replace(/[,\s]+$/, '')
      .replace(/\/+$/, '');
  }

  private getPayoutCallbackUrl(): string {
    const backendUrl = this.getBackendUrl();
    if (!backendUrl) {
      throw new BadRequestException(
        'BACKEND_URL is required for Flutterwave payout callbacks',
      );
    }

    return `${backendUrl}/api/payments/payout-callback`;
  }

  /**
   * Initialize a payment with Flutterwave
   */
  async initializePayment(
    dto: InitializePaymentDto,
    userId: string,
    transactionRef: string,
  ) {
    if (!this.secretKey) {
      throw new BadRequestException('Payment service not configured');
    }

    try {
      const payload: Record<string, unknown> = {
        tx_ref: transactionRef,
        amount: dto.amount,
        currency: dto.currency || 'UGX',
        redirect_url: dto.redirectUrl,
        customer: {
          email: dto.email,
          phonenumber: dto.phoneNumber,
        },
        customizations: {
          title: 'KEIBO Payment',
          description: `Investment in project ${dto.projectId}`,
        },
        meta: {
          userId,
          projectId: dto.projectId,
          paymentMethod: dto.paymentMethod,
        },
      };

      // Handle different payment methods
      if (dto.paymentMethod === PaymentMethod.MobileMoney) {
        if (!dto.phoneNumber) {
          throw new BadRequestException(
            'Phone number required for mobile money',
          );
        }
        if (!dto.mobileMoneyProvider) {
          throw new BadRequestException('Mobile money provider required');
        }

        // Mobile money charge
        const mobileMoneyPayload = {
          tx_ref: transactionRef,
          amount: dto.amount.toString(),
          currency: 'UGX',
          email: dto.email,
          phone_number: dto.phoneNumber,
          fullname: dto.email.split('@')[0],
          redirect_url: dto.redirectUrl,
          meta: payload.meta,
        };

        // Map provider to Flutterwave network
        const networkMap: Record<MobileMoneyProvider, string> = {
          [MobileMoneyProvider.MTN]: 'MTN',
          [MobileMoneyProvider.Airtel]: 'AIRTEL',
          [MobileMoneyProvider.Vodafone]: 'VODAFONE',
        };

        const response = await firstValueFrom(
          this.httpService.post<ProviderResponse>(
            `${this.baseUrl}/charges?type=mobile_money_uganda`,
            {
              ...mobileMoneyPayload,
              network: networkMap[dto.mobileMoneyProvider],
            },
            {
              headers: {
                Authorization: `Bearer ${this.secretKey}`,
                'Content-Type': 'application/json',
              },
            },
          ),
        );

        this.logger.log(`Mobile money payment initialized: ${transactionRef}`);
        return response.data;
      } else {
        // Standard payment (card, bank transfer) - use payment link
        const response = await firstValueFrom(
          this.httpService.post<ProviderResponse>(
            `${this.baseUrl}/payments`,
            payload,
            {
              headers: {
                Authorization: `Bearer ${this.secretKey}`,
                'Content-Type': 'application/json',
              },
            },
          ),
        );

        this.logger.log(`Payment initialized: ${transactionRef}`);
        return response.data;
      }
    } catch (error: unknown) {
      const failure = providerError(error);
      this.logger.error(
        `Failed to initialize payment: ${failure.message}`,
        failure.stack,
      );
      throw new BadRequestException(
        `Payment initialization failed: ${failure.message}`,
      );
    }
  }

  /**
   * Verify a transaction
   */
  async verifyTransaction(transactionId: string) {
    if (!this.secretKey) {
      throw new BadRequestException('Payment service not configured');
    }

    try {
      const response = await firstValueFrom(
        this.httpService.get<ProviderResponse>(
          `${this.baseUrl}/transactions/${transactionId}/verify`,
          {
            headers: {
              Authorization: `Bearer ${this.secretKey}`,
            },
          },
        ),
      );

      this.logger.log(`Transaction verified: ${transactionId}`);
      return response.data;
    } catch (error: unknown) {
      const failure = providerError(error);
      this.logger.error(
        `Failed to verify transaction: ${failure.message}`,
        failure.stack,
      );
      throw new BadRequestException(
        `Transaction verification failed: ${failure.message}`,
      );
    }
  }

  /**
   * Verify webhook signature
   */
  verifyWebhookSignature(signature: string, payload: unknown): boolean {
    void payload;
    const secretHash = this.configService.get<string>(
      'FLUTTERWAVE_WEBHOOK_SECRET',
    );

    if (!secretHash) {
      this.logger.warn('Webhook secret not configured');
      return false;
    }

    const supplied = Buffer.from(signature || '');
    const expected = Buffer.from(secretHash);
    return (
      supplied.length === expected.length &&
      crypto.timingSafeEqual(supplied, expected)
    );
  }

  /**
   * Process payout (withdrawal)
   */
  async processPayout(params: {
    amount: number;
    currency: string;
    accountNumber: string;
    accountBank: string;
    narration: string;
    reference: string;
    beneficiaryName?: string;
    email?: string;
    mobileNumber?: string;
  }) {
    if (!this.secretKey) {
      throw new BadRequestException('Payment service not configured');
    }

    try {
      // Flutterwave requires 'MPS' as the destination bank for Mobile Money Wallets in Uganda
      const isMomoUG =
        params.currency === 'UGX' &&
        ['MTN', 'AIRTEL'].includes(params.accountBank.toUpperCase());
      const finalAccountBank = isMomoUG ? 'MPS' : params.accountBank;

      const payload = {
        account_bank: finalAccountBank,
        account_number: params.accountNumber,
        amount: params.amount,
        currency: params.currency,
        narration: params.narration,
        reference: params.reference,
        callback_url: this.getPayoutCallbackUrl(),
        debit_currency: params.currency,
        ...(params.beneficiaryName && {
          beneficiary_name: params.beneficiaryName,
        }),
        ...(isMomoUG && {
          meta: [
            {
              mobile_number: params.mobileNumber || params.accountNumber,
              email: params.email || 'noreply@keiboroi.com',
              beneficiary_name: params.beneficiaryName || 'User',
              beneficiary_country: 'UG',
            },
          ],
        }),
      };

      const response = await firstValueFrom(
        this.httpService.post<ProviderResponse>(
          `${this.baseUrl}/transfers`,
          payload,
          {
            headers: {
              Authorization: `Bearer ${this.secretKey}`,
              'Content-Type': 'application/json',
            },
          },
        ),
      );

      this.logger.log(`Payout initiated: ${params.reference}`);
      return response.data;
    } catch (error: unknown) {
      const failure = providerError(error);
      this.logger.error(
        `Failed to process payout: ${failure.message}`,
        failure.stack,
      );
      throw new BadRequestException(`Payout failed: ${failure.message}`);
    }
  }

  async getTransfer(transferId: string | number) {
    if (!this.secretKey) {
      throw new BadRequestException('Payment service not configured');
    }

    try {
      const response = await firstValueFrom(
        this.httpService.get<ProviderResponse>(
          `${this.baseUrl}/transfers/${transferId}`,
          {
            headers: {
              Authorization: `Bearer ${this.secretKey}`,
            },
          },
        ),
      );

      return response.data;
    } catch (error: unknown) {
      const failure = providerError(error);
      this.logger.error(
        `Failed to fetch transfer ${transferId}: ${failure.message}`,
        failure.stack,
      );
      throw new BadRequestException(
        `Transfer lookup failed: ${failure.message}`,
      );
    }
  }

  /**
   * Get bank list for a country
   */
  async getBankList(country: string = 'UG') {
    if (!this.secretKey) {
      throw new BadRequestException('Payment service not configured');
    }

    try {
      const response = await firstValueFrom(
        this.httpService.get<ProviderResponse>(
          `${this.baseUrl}/banks/${country}`,
          {
            headers: {
              Authorization: `Bearer ${this.secretKey}`,
            },
          },
        ),
      );

      return response.data;
    } catch (error: unknown) {
      const failure = providerError(error);
      this.logger.error(
        `Failed to get bank list: ${failure.message}`,
        failure.stack,
      );
      throw new BadRequestException(
        `Failed to get bank list: ${failure.message}`,
      );
    }
  }
}
