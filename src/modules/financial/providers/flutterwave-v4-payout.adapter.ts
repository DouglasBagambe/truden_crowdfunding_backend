import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { firstValueFrom } from 'rxjs';
export type PayoutProviderStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'SUCCESSFUL'
  | 'FAILED'
  | 'UNKNOWN';
@Injectable()
export class FlutterwaveV4PayoutAdapter {
  constructor(
    private readonly config: ConfigService,
    private readonly http: HttpService,
  ) {}
  async createRecipient(input: {
    type: 'bank' | 'mobile_money';
    accountNumber: string;
    bankOrNetwork: string;
    accountName?: string;
    idempotencyKey: string;
  }) {
    const result = await this.post(
      '/transfers/recipients',
      input.type === 'bank'
        ? {
            type: 'bank_account',
            account_number: input.accountNumber,
            bank_code: input.bankOrNetwork,
            account_name: input.accountName,
            currency: 'UGX',
            country: 'UG',
          }
        : {
            type: 'mobile_money',
            account_number: input.accountNumber,
            network: input.bankOrNetwork,
            account_name: input.accountName,
            currency: 'UGX',
            country: 'UG',
          },
      input.idempotencyKey,
    );
    const id = this.scalar(result.id ?? result.recipient_id);
    if (!id)
      throw new ServiceUnavailableException(
        'Flutterwave returned no recipient identifier',
      );
    return {
      id,
      metadata: {
        network: this.scalar(result.network ?? result.bank_code),
        status: this.scalar(result.status),
      },
    };
  }
  async createTransfer(input: {
    recipientId: string;
    amountMinor: bigint;
    currency: string;
    reference: string;
    narration: string;
    idempotencyKey: string;
  }) {
    const result = await this.post(
      '/transfers',
      {
        action: 'instant',
        reference: input.reference,
        narration: input.narration,
        callback_url: this.callbackUrl(),
        payment_instruction: {
          recipient_id: input.recipientId,
          amount: input.amountMinor.toString(),
          currency: input.currency,
        },
        meta: { keibo_reference: input.reference },
      },
      input.idempotencyKey,
    );
    const id = this.scalar(result.id ?? result.transfer_id);
    if (!id)
      throw new ServiceUnavailableException(
        'Flutterwave returned no transfer identifier',
      );
    return { id, status: this.status(this.scalar(result.status)) };
  }
  async getTransferStatus(id: string) {
    try {
      const response = await firstValueFrom(
        this.http.get(`${this.baseUrl()}/transfers/${encodeURIComponent(id)}`, {
          headers: this.headers(),
        }),
      );
      const data = this.data(response.data);
      return {
        id: this.scalar(data.id) || id,
        reference: this.scalar(data.reference),
        status: this.status(this.scalar(data.status)),
        amount: this.scalar(data.amount),
        currency: this.scalar(data.destination_currency ?? data.currency),
      };
    } catch (error) {
      throw this.providerError(error);
    }
  }
  verifyWebhookSignature(
    raw: Buffer | undefined,
    signature: string | undefined,
  ) {
    const secret = this.config
      .get<string>('FLUTTERWAVE_WEBHOOK_SECRET')
      ?.trim();
    if (!raw || !signature || !secret) return false;
    const expected = Buffer.from(
      createHmac('sha256', secret).update(raw).digest('base64'),
    );
    const got = Buffer.from(signature);
    return got.length === expected.length && timingSafeEqual(got, expected);
  }
  private async post(path: string, body: unknown, idempotencyKey: string) {
    try {
      const response = await firstValueFrom(
        this.http.post(`${this.baseUrl()}${path}`, body, {
          headers: this.headers(idempotencyKey),
        }),
      );
      return this.data(response.data);
    } catch (error) {
      throw this.providerError(error);
    }
  }
  private headers(idempotencyKey?: string) {
    const key = this.config.get<string>('FLUTTERWAVE_SECRET_KEY')?.trim();
    if (!key)
      throw new ServiceUnavailableException(
        'Flutterwave payout provider is not configured',
      );
    return {
      Authorization: `Bearer ${key}`,
      'X-Trace-Id': randomUUID(),
      ...(idempotencyKey ? { 'X-Idempotency-Key': idempotencyKey } : {}),
    };
  }
  private baseUrl() {
    return (
      this.config
        .get<string>('FLUTTERWAVE_V4_BASE_URL')
        ?.trim()
        .replace(/\/$/, '') || 'https://developersandbox-api.flutterwave.com'
    );
  }
  private callbackUrl() {
    const url = this.config
      .get<string>('BACKEND_URL')
      ?.trim()
      .replace(/\/$/, '');
    if (!url)
      throw new ServiceUnavailableException(
        'BACKEND_URL is required for payouts',
      );
    return `${url}/api/financial/payouts/flutterwave/callback`;
  }
  private data(value: unknown): Record<string, unknown> {
    const obj =
      value && typeof value === 'object'
        ? (value as Record<string, unknown>)
        : {};
    return obj.data && typeof obj.data === 'object'
      ? (obj.data as Record<string, unknown>)
      : obj;
  }
  private providerError(error: unknown): Error {
    const candidate = error as {
      code?: unknown;
      response?: { status?: unknown };
    };
    const status =
      typeof candidate.response?.status === 'number'
        ? candidate.response.status
        : undefined;
    const retryable =
      status === 429 ||
      (typeof status === 'number' && status >= 500) ||
      ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN'].includes(
        String(candidate.code),
      );
    return Object.assign(
      new Error(
        retryable
          ? 'Flutterwave payout provider is temporarily unavailable'
          : 'Flutterwave payout provider rejected the request',
      ),
      { code: retryable ? 'PROVIDER_RETRYABLE' : 'PROVIDER_PERMANENT' },
    );
  }
  private scalar(value: unknown) {
    return typeof value === 'string' || typeof value === 'number'
      ? String(value)
      : '';
  }
  private status(value: string): PayoutProviderStatus {
    const s = value.toUpperCase();
    if (['SUCCESSFUL', 'COMPLETED'].includes(s)) return 'SUCCESSFUL';
    if (['FAILED', 'CANCELLED', 'REVERSED'].includes(s)) return 'FAILED';
    if (['PROCESSING', 'IN_PROGRESS'].includes(s)) return 'PROCESSING';
    if (['NEW', 'PENDING', 'QUEUED'].includes(s)) return 'PENDING';
    return 'UNKNOWN';
  }
}
