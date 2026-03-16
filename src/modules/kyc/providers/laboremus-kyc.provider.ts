import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import {
    IKycProviderService,
    KycProviderStatusResult,
    KycProviderSubmitResult,
} from './kyc-provider.interface';
import type { KycProfileDocument } from '../schemas/kyc-profile.schema';
import type { KycWebhookDto } from '../dto/kyc-webhook.dto';

/**
 * Laboremus Uganda KYC/KYB Provider
 *
 * Laboremus is a local Ugandan provider integrated with NIRA for
 * real-time ID verification, and also supports business KYB.
 *
 * Typical API flow:
 *   POST /verify/individual  → { reference, status, score }
 *   GET  /verify/{reference} → status poll
 *   Webhook at POST /kyc/webhook/laboremus
 *
 * NOTE: Update the endpoint paths below when Laboremus shares their
 * official API documentation, as these are standard paths deduced from
 * their advertised service. Replace LABOREMUS_API_BASE_URL and
 * LABOREMUS_API_KEY in .env.
 *
 * Status mapping:
 *   VERIFIED / MATCH     → APPROVED
 *   MISMATCH / FAILED    → REJECTED
 *   PENDING / PROCESSING → UNDER_REVIEW
 */
@Injectable()
export class LaboremusKycProviderService implements IKycProviderService {
    private readonly logger = new Logger(LaboremusKycProviderService.name);

    constructor(private readonly configService: ConfigService) { }

    getProviderName(): string {
        return 'laboremus';
    }

    private get apiKey(): string {
        return this.configService.get<string>('LABOREMUS_API_KEY') ?? '';
    }

    private get baseUrl(): string {
        return (
            this.configService.get<string>('LABOREMUS_API_BASE_URL') ??
            'https://api.laboremus.ug/kyc/v1'
        );
    }

    async submitApplication(
        profile: KycProfileDocument,
    ): Promise<KycProviderSubmitResult> {
        const userId = profile.userId.toString();

        // Check if this is a business KYB or individual KYC
        const isBusinessKyb = (profile as any).isBusiness === true;

        try {
            const endpoint = isBusinessKyb
                ? `${this.baseUrl}/verify/business`
                : `${this.baseUrl}/verify/individual`;

            const payload: Record<string, any> = isBusinessKyb
                ? {
                    // Business KYB fields
                    business_name: (profile as any).businessName,
                    registration_number: (profile as any).businessRegNumber,
                    country: profile.country ?? 'UG',
                }
                : {
                    // Individual KYC fields
                    first_name: profile.firstName,
                    last_name: profile.lastName,
                    date_of_birth: profile.dateOfBirth
                        ? profile.dateOfBirth.toISOString().split('T')[0]
                        : undefined,
                    id_type: profile.idType,
                    id_number_last4: profile.idNumberLast4,
                    country: profile.country ?? 'UG',
                    vendor_reference: userId,
                };

            const response = await axios.post(endpoint, payload, {
                headers: this.buildHeaders(),
            });

            const data = response.data as {
                reference: string;
                status: string;
                score?: number;
            };

            this.logger.log(
                `Laboremus verification submitted for user ${userId}: ref=${data.reference}`,
            );

            return {
                reference: data.reference,
                status: this.mapLaboremusStatus(data.status),
                rawResponse: data,
            };
        } catch (err: any) {
            const msg = err?.response?.data?.message ?? err.message;
            this.logger.error(`Laboremus submission failed for user ${userId}: ${msg}`);
            throw new Error(`Laboremus KYC submission failed: ${msg}`);
        }
    }

    async refreshStatus(
        profile: KycProfileDocument,
    ): Promise<KycProviderStatusResult> {
        const reference = profile.providerReference;
        if (!reference) {
            return {
                reference: '',
                status: 'UNKNOWN',
                rawResponse: { error: 'No reference stored' },
            };
        }

        try {
            const response = await axios.get(
                `${this.baseUrl}/verify/${reference}`,
                { headers: this.buildHeaders() },
            );
            const data = response.data as { reference: string; status: string };

            return {
                reference: data.reference,
                status: this.mapLaboremusStatus(data.status),
                rawResponse: data,
            };
        } catch (err: any) {
            const msg = err?.response?.data?.message ?? err.message;
            this.logger.error(`Laboremus refresh failed for ref ${reference}: ${msg}`);
            return {
                reference,
                status: 'UNDER_REVIEW',
                rawResponse: { error: msg },
            };
        }
    }

    async handleWebhook(
        dto: KycWebhookDto,
    ): Promise<KycProviderStatusResult | null> {
        const payload = dto.payload ?? {};
        const reference = (payload.reference ?? dto.reference ?? '').toString();

        if (!reference) {
            this.logger.warn('Laboremus webhook: missing reference');
            return null;
        }

        const rawStatus = (payload.status ?? dto.status ?? '').toString();
        const mappedStatus = this.mapLaboremusStatus(rawStatus);

        this.logger.log(
            `Laboremus webhook: ref=${reference}, rawStatus=${rawStatus}, mapped=${mappedStatus}`,
        );

        return {
            reference,
            status: mappedStatus,
            rawResponse: payload,
        };
    }

    private mapLaboremusStatus(raw: string): string {
        const up = (raw ?? '').toUpperCase();
        switch (up) {
            case 'VERIFIED':
            case 'MATCH':
            case 'APPROVED':
            case 'SUCCESS':
                return 'APPROVED';
            case 'MISMATCH':
            case 'FAILED':
            case 'REJECTED':
            case 'DECLINED':
                return 'REJECTED';
            case 'PENDING':
            case 'PROCESSING':
            case 'UNDER_REVIEW':
            case 'IN_PROGRESS':
                return 'UNDER_REVIEW';
            default:
                return 'PENDING';
        }
    }

    private buildHeaders(): Record<string, string> {
        return {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
        };
    }
}
