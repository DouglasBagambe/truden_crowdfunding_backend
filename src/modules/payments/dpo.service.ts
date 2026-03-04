import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { parseStringPromise, Builder } from 'xml2js';

export interface DpoCreateTokenResult {
    token: string;
    transactionToken: string;
}

export interface DpoVerifyResult {
    status: string;
    message: string;
    transactionRef?: string;
    amount?: string;
    currency?: string;
}

export interface DpoBuildXmlOptions {
    CompanyToken: string;
    Request: string;
    [key: string]: any;
}

@Injectable()
export class DpoService {
    private readonly logger = new Logger(DpoService.name);
    private readonly companyToken: string;
    private readonly apiUrl: string;

    constructor(
        private readonly configService: ConfigService,
        private readonly httpService: HttpService,
    ) {
        this.companyToken = this.configService.get<string>('DPO_COMPANY_TOKEN') ?? '';
        this.apiUrl =
            this.configService.get<string>('DPO_API_URL') ??
            'https://secure.3gdirectpay.com/API/v6/';

        if (!this.companyToken) {
            this.logger.warn('DPO_COMPANY_TOKEN not configured. DPO payments will be unavailable.');
        } else {
            this.logger.log('DPO service initialized');
        }
    }

    get isConfigured() {
        return !!this.companyToken;
    }

    // ─── XML helper ────────────────────────────────────────────────────

    private buildXml(body: Record<string, any>): string {
        const builder = new Builder({ headless: true });
        return builder.buildObject({ API3G: { CompanyToken: this.companyToken, ...body } });
    }

    private async postToApi(xml: string): Promise<Record<string, any>> {
        const response = await firstValueFrom(
            this.httpService.post(this.apiUrl, xml, {
                headers: { 'Content-Type': 'application/xml' },
            }),
        );
        const parsed = await parseStringPromise(response.data, { explicitArray: false });
        return (parsed.API3G ?? parsed) as Record<string, any>;
    }

    // ─── createToken ────────────────────────────────────────────────────

    /**
     * Step 1: Create a transaction token for a payment.
     * @param projectId  - internal project ID (used in description)
     * @param amount     - amount in smallest unit (UGX as integer)
     * @param currency   - ISO currency code (default: UGX)
     * @param backUrl    - URL to call when payment is done (backend endpoint)
     * @param redirectUrl - URL to redirect the user after card payment
     */
    async createToken(
        projectId: string,
        amount: number,
        currency = 'UGX',
        backUrl: string,
        redirectUrl: string,
        description = 'Investment via Truden',
    ): Promise<DpoCreateTokenResult> {
        if (!this.isConfigured) {
            throw new BadRequestException('DPO payment gateway is not configured');
        }

        const now = new Date();
        const paymentDate = now
            .toISOString()
            .replace(/[-:]/g, '')
            .replace('T', ' ')
            .slice(0, 17);

        const xml = this.buildXml({
            Request: 'createToken',
            Transaction: {
                PaymentAmount: amount.toFixed(2),
                PaymentCurrency: currency,
                CompanyRef: `TRUDEN-${projectId}-${Date.now()}`,
                RedirectURL: redirectUrl,
                BackURL: backUrl,
                CompanyRefUnique: 0,
                PTL: 60, // 60 minute payment time limit
                PaymentDate: paymentDate,
                Description: description,
            },
            Services: {
                Service: {
                    ServiceType: '104563', // Live: Web Services (Truden Tech)
                    ServiceDescription: description,
                    ServiceDate: paymentDate,
                },
            },
        });

        const result = await this.postToApi(xml);

        if (result.Result !== '000') {
            throw new BadRequestException(
                `DPO createToken failed: ${result.ResultExplanation ?? result.Result}`,
            );
        }

        return {
            token: result.TransToken,
            transactionToken: result.TransToken,
        };
    }

    // ─── chargeTokenMobile ─────────────────────────────────────────────

    /**
     * Step 2a (Mobile Money): Charges the token via mobile money.
     * Returns the instructions/USSD prompt that must be shown to the user.
     */
    async chargeTokenMobile(
        token: string,
        phoneNumber: string,
        mno: 'MTN' | 'AIRTEL',
    ): Promise<{ instructions: string; result: string }> {
        if (!this.isConfigured) {
            throw new BadRequestException('DPO payment gateway is not configured');
        }

        const xml = this.buildXml({
            Request: 'chargeTokenMobile',
            TransactionToken: token,
            PhoneNumber: phoneNumber,
            MNO: mno,
            CountryCode: 'UG',
        });

        const result = await this.postToApi(xml);

        return {
            result: result.Result,
            instructions: result.Instructions ?? result.ResultExplanation ?? 'Follow USSD prompt',
        };
    }

    // ─── chargeTokenCreditCard ─────────────────────────────────────────

    /**
     * Step 2b (Card): Charges the token with credit/debit card.
     */
    async chargeTokenCreditCard(
        token: string,
        card: {
            number: string;
            expiryMonth: string;
            expiryYear: string;
            cvv: string;
            holderName: string;
        },
    ): Promise<{ result: string; message: string }> {
        if (!this.isConfigured) {
            throw new BadRequestException('DPO payment gateway is not configured');
        }

        const xml = this.buildXml({
            Request: 'chargeTokenCreditCard',
            TransactionToken: token,
            CreditCardNumber: card.number,
            CreditCardExpiry: `${card.expiryMonth}${card.expiryYear}`,
            CreditCardCVV: card.cvv,
            CardHolderName: card.holderName,
            ChargeType: '',
        });

        const result = await this.postToApi(xml);

        return {
            result: result.Result,
            message: result.ResultExplanation ?? '',
        };
    }

    // ─── verifyToken ───────────────────────────────────────────────────

    /**
     * Step 3: Verify payment status. Returns status '000' on success.
     */
    async verifyToken(token: string): Promise<DpoVerifyResult> {
        if (!this.isConfigured) {
            throw new BadRequestException('DPO payment gateway is not configured');
        }

        const xml = this.buildXml({
            Request: 'verifyToken',
            TransactionToken: token,
        });

        const result = await this.postToApi(xml);

        return {
            status: result.Result,
            message: result.ResultExplanation ?? '',
            transactionRef: result.CompanyRef,
            amount: result.TransactionAmount,
            currency: result.TransactionCurrency,
        };
    }
}
