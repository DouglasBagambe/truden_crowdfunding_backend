import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { InitializePaymentDto } from './dto/initialize-payment.dto';
import { PaymentMethod, MobileMoneyProvider } from './schemas/payment-transaction.schema';

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
        this.publicKey = this.configService.get<string>('FLUTTERWAVE_PUBLIC_KEY') || '';
        this.secretKey = this.configService.get<string>('FLUTTERWAVE_SECRET_KEY') || '';

        if (!this.publicKey || !this.secretKey) {
            this.logger.warn('Flutterwave keys not configured. Payment features will be disabled.');
        } else {
            this.logger.log('Flutterwave service initialized');
        }
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
            const payload: any = {
                tx_ref: transactionRef,
                amount: dto.amount,
                currency: dto.currency || 'UGX',
                redirect_url: dto.redirectUrl,
                customer: {
                    email: dto.email,
                    phonenumber: dto.phoneNumber,
                },
                customizations: {
                    title: 'FundFlow Investment',
                    description: `Investment in project ${dto.projectId}`,
                    logo: 'https://your-logo-url.com/logo.png',
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
                    throw new BadRequestException('Phone number required for mobile money');
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
                    this.httpService.post(
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
                    this.httpService.post(
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
        } catch (error: any) {
            this.logger.error(`Failed to initialize payment: ${error.message}`, error.stack);
            throw new BadRequestException(`Payment initialization failed: ${error.message}`);
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
                this.httpService.get(
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
        } catch (error: any) {
            this.logger.error(`Failed to verify transaction: ${error.message}`, error.stack);
            throw new BadRequestException(`Transaction verification failed: ${error.message}`);
        }
    }

    /**
     * Verify webhook signature
     */
    verifyWebhookSignature(signature: string, payload: any): boolean {
        const secretHash = this.configService.get<string>('FLUTTERWAVE_WEBHOOK_SECRET');

        if (!secretHash) {
            this.logger.warn('Webhook secret not configured');
            return false;
        }

        return signature === secretHash;
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
    }) {
        if (!this.secretKey) {
            throw new BadRequestException('Payment service not configured');
        }

        try {
            const payload = {
                account_bank: params.accountBank,
                account_number: params.accountNumber,
                amount: params.amount,
                currency: params.currency,
                narration: params.narration,
                reference: params.reference,
                callback_url: this.configService.get<string>('BACKEND_URL') + '/api/payments/payout-callback',
                debit_currency: params.currency,
            };

            const response = await firstValueFrom(
                this.httpService.post(
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
        } catch (error: any) {
            this.logger.error(`Failed to process payout: ${error.message}`, error.stack);
            throw new BadRequestException(`Payout failed: ${error.message}`);
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
                this.httpService.get(
                    `${this.baseUrl}/banks/${country}`,
                    {
                        headers: {
                            Authorization: `Bearer ${this.secretKey}`,
                        },
                    },
                ),
            );

            return response.data;
        } catch (error: any) {
            this.logger.error(`Failed to get bank list: ${error.message}`, error.stack);
            throw new BadRequestException(`Failed to get bank list: ${error.message}`);
        }
    }
}
