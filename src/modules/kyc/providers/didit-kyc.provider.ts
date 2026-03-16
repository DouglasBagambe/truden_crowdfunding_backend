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
 * Didit KYC Provider
 *
 * Didit offers hosted verification sessions. The flow is:
 * 1. POST /v3/session/ → returns { session_id, verification_url }
 * 2. Redirect the user to verification_url
 * 3. Didit calls our webhook at POST /kyc/webhook/didit with the result
 * 4. We can also poll GET /v3/session/{session_id} for status
 *
 * Docs: https://docs.didit.me
 *
 * Status mapping (Didit → internal):
 *   Didit:    Approved | Declined | Expired | Processing | Initialized
 *   Internal: APPROVED | REJECTED | EXPIRED | UNDER_REVIEW | PENDING
 */
@Injectable()
export class DiditKycProviderService implements IKycProviderService {
    private readonly logger = new Logger(DiditKycProviderService.name);

    constructor(private readonly configService: ConfigService) { }

    getProviderName(): string {
        return 'didit';
    }

    private get apiKey(): string {
        return this.configService.get<string>('DIDIT_API_KEY') ?? '';
    }

    private get clientId(): string {
        return this.configService.get<string>('DIDIT_CLIENT_ID') ?? '';
    }

    private get baseUrl(): string {
        const sandbox =
            String(this.configService.get('DIDIT_SANDBOX') ?? 'false').toLowerCase() === 'true';
        return sandbox
            ? 'https://sandbox.didit.me'
            : 'https://verification.didit.me';
    }

    private get backendUrl(): string {
        return this.configService.get<string>('BACKEND_URL') ?? 'https://trufund.onrender.com';
    }

    /**
     * Create a hosted Didit verification session.
     * Returns the reference (session_id) and the redirectUrl for the frontend.
     */
    async submitApplication(
        profile: KycProfileDocument,
    ): Promise<KycProviderSubmitResult> {
        const userId = profile.userId.toString();

        try {
            const payload: Record<string, any> = {
                callback: `${this.backendUrl}/api/kyc/webhook/didit`,
                vendor_data: userId, // echoed back in webhook — we use this to find the profile
                steps: {
                    face_authentication: {
                        active: true,
                    },
                    review: {
                        active: true,
                    },
                },
            };

            const headers = this.buildHeaders();

            const response = await axios.post(`${this.baseUrl}/v3/session/`, payload, { headers });
            const data = response.data as {
                session_id: string;
                url: string;
                status?: string;
            };

            this.logger.log(
                `Didit session created for user ${userId}: sessionId=${data.session_id}`,
            );

            return {
                reference: data.session_id,
                status: 'PENDING',
                rawResponse: {
                    ...data,
                    verificationUrl: data.url,
                },
            };
        } catch (err: any) {
            const msg = err?.response?.data?.message ?? err.message;
            this.logger.error(`Didit session creation failed for user ${userId}: ${msg}`);
            throw new Error(`Didit KYC session creation failed: ${msg}`);
        }
    }

    /**
     * Poll Didit for the current status of an existing session.
     */
    async refreshStatus(
        profile: KycProfileDocument,
    ): Promise<KycProviderStatusResult> {
        const sessionId = profile.providerReference;
        if (!sessionId) {
            return {
                reference: '',
                status: 'UNKNOWN',
                rawResponse: { error: 'No session ID stored' },
            };
        }

        try {
            const headers = this.buildHeaders();
            const response = await axios.get(
                `${this.baseUrl}/v3/session/${sessionId}`,
                { headers },
            );
            const data = response.data as { session_id: string; status: string };

            return {
                reference: data.session_id,
                status: this.mapDiditStatus(data.status),
                rawResponse: data,
            };
        } catch (err: any) {
            const msg = err?.response?.data?.message ?? err.message;
            this.logger.error(
                `Didit status refresh failed for session ${sessionId}: ${msg}`,
            );
            return {
                reference: sessionId,
                status: 'UNDER_REVIEW',
                rawResponse: { error: msg },
            };
        }
    }

    /**
     * Handle Didit webhook payload.
     * Didit sends: { session_id, status, vendor_data, ... }
     */
    async handleWebhook(
        dto: KycWebhookDto,
    ): Promise<KycProviderStatusResult | null> {
        const payload = dto.payload ?? {};
        const sessionId = (payload.session_id ?? dto.reference ?? '').toString();

        if (!sessionId) {
            this.logger.warn('Didit webhook: missing session_id');
            return null;
        }

        const rawStatus = (payload.status ?? dto.status ?? '').toString();
        const mappedStatus = this.mapDiditStatus(rawStatus);

        this.logger.log(
            `Didit webhook: sessionId=${sessionId}, rawStatus=${rawStatus}, mapped=${mappedStatus}`,
        );

        return {
            reference: sessionId,
            status: mappedStatus,
            rawResponse: payload,
        };
    }

    /**
     * Map Didit status strings → our internal status strings.
     * Didit statuses: Approved, Declined, Expired, Processing, Failed, etc.
     */
    private mapDiditStatus(raw: string): string {
        const up = (raw ?? '').toUpperCase();
        switch (up) {
            case 'APPROVED':
            case 'VERIFIED':
                return 'APPROVED';
            case 'DECLINED':
            case 'REJECTED':
            case 'FAILED':
                return 'REJECTED';
            case 'EXPIRED':
                return 'EXPIRED';
            case 'PROCESSING':
            case 'UNDER_REVIEW':
            case 'IN_PROGRESS':
                return 'UNDER_REVIEW';
            default:
                return 'PENDING';
        }
    }

    private buildHeaders(): Record<string, string> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };

        if (this.apiKey) {
            // x-api-key style auth
            headers['x-api-key'] = this.apiKey;
        }

        if (this.clientId) {
            headers['x-client-id'] = this.clientId;
        }

        return headers;
    }
}
