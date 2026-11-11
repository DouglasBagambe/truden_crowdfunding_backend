import {
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { DpoVerifyResult } from '../../payments/dpo.service';
import type { ProviderEvent } from '../financial.types';
import { decimalToMinor } from './provider-adapter';

@Injectable()
export class DpoFinancialAdapter {
  readonly provider = 'dpo';
  constructor(private readonly config: ConfigService) {}

  isConfigured(): boolean {
    const token = this.config.get<string>('DPO_COMPANY_TOKEN')?.trim();
    const url = this.config.get<string>('DPO_API_URL')?.trim();
    return Boolean(
      token &&
        url &&
        /^https:\/\//.test(url) &&
        !/(replace|example|placeholder)/i.test(`${token}${url}`),
    );
  }

  fromVerifiedToken(params: {
    token: string;
    paymentIntentId: string;
    evidence: DpoVerifyResult;
  }): ProviderEvent {
    if (!this.isConfigured())
      throw new ServiceUnavailableException('DPO adapter is disabled');
    const { evidence } = params;
    const currency = String(evidence.currency ?? '').toUpperCase();
    if (
      evidence.status !== '000' ||
      !evidence.amount ||
      !currency ||
      !params.token ||
      !params.paymentIntentId
    ) {
      throw new ForbiddenException(
        'DPO verification evidence is incomplete or unsuccessful',
      );
    }
    const grossMinor = decimalToMinor(evidence.amount, currency);
    // DPO can report sub-shilling fees. Allocate only whole UGX to the campaign.
    const netAmount = evidence.netAmount?.trim();
    const fractionalUgx =
      currency === 'UGX' && netAmount
        ? /^(\d+)\.(\d*[1-9]\d*)$/.exec(netAmount)
        : null;
    const netMinor = netAmount
      ? decimalToMinor(fractionalUgx?.[1] ?? netAmount, currency)
      : grossMinor;
    if (netMinor > grossMinor || (fractionalUgx && netMinor === grossMinor)) {
      throw new ForbiddenException('DPO net amount exceeds gross amount');
    }
    return {
      provider: this.provider,
      providerEventId: `verified-token:${params.token}`,
      eventType: 'captured',
      paymentIntentId: params.paymentIntentId,
      amountMinor: grossMinor,
      currency,
      providerFeeMinor: grossMinor - netMinor,
      receivedAt: new Date(),
    };
  }
}
