import {
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'crypto';
import type { ProviderEvent } from '../financial.types';
import {
  decimalToMinor,
  type ProviderCallbackAdapter,
} from './provider-adapter';

type FlutterwavePayload = Record<string, unknown> & {
  data?: Record<string, unknown>;
};

function scalarString(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : '';
}

@Injectable()
export class FlutterwaveFinancialAdapter
  implements ProviderCallbackAdapter<FlutterwavePayload>
{
  readonly provider = 'flutterwave';
  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    const secret = this.config
      .get<string>('FLUTTERWAVE_WEBHOOK_SECRET')
      ?.trim();
    return Boolean(secret && !/(replace|example|placeholder)/i.test(secret));
  }

  verifyAndNormalize(
    payload: FlutterwavePayload,
    signature: string | undefined,
  ): ProviderEvent {
    const secret = this.config
      .get<string>('FLUTTERWAVE_WEBHOOK_SECRET')
      ?.trim();
    if (!this.isConfigured() || !secret)
      throw new ServiceUnavailableException('Flutterwave adapter is disabled');
    const supplied = Buffer.from(signature ?? '');
    const expected = Buffer.from(secret);
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    ) {
      throw new ForbiddenException('Flutterwave webhook signature is invalid');
    }
    const data = payload.data ?? payload;
    const meta =
      data.meta && typeof data.meta === 'object'
        ? (data.meta as Record<string, unknown>)
        : {};
    const status = scalarString(data.status).toLowerCase();
    const eventType =
      status === 'successful'
        ? 'captured'
        : status === 'failed'
          ? 'failed'
          : undefined;
    const paymentIntentId = scalarString(meta.paymentIntentId);
    const providerEventId = scalarString(data.id) || scalarString(data.tx_ref);
    const currency = scalarString(data.currency).toUpperCase();
    if (!eventType || !paymentIntentId || !providerEventId || !currency)
      throw new ForbiddenException('Flutterwave evidence is incomplete');
    return {
      provider: this.provider,
      providerEventId,
      eventType,
      paymentIntentId,
      amountMinor: decimalToMinor(data.amount, currency),
      currency,
      providerFeeMinor:
        data.app_fee === undefined
          ? undefined
          : decimalToMinor(data.app_fee, currency),
      receivedAt: new Date(),
    };
  }
}
