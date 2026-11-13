import {
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { DpoVerifyResult } from '../../payments/dpo.service';
import type { ProviderEvent } from '../financial.types';
import { decimalToMinor } from './provider-adapter';
import { createHash } from 'crypto';

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
    return this.fromEvidence(params, 'captured');
  }

  fromVerifiedSettlement(params: {
    token: string;
    paymentIntentId: string;
    evidence: DpoVerifyResult;
  }): ProviderEvent {
    if (!params.evidence.netAmount?.trim()) {
      throw new ForbiddenException(
        'DPO verification evidence has no net settlement amount',
      );
    }
    if (!this.hasCompletedSettlement(params.evidence)) {
      throw new ForbiddenException('DPO settlement date has not completed');
    }
    return this.fromEvidence(params, 'settled');
  }

  hasCompletedSettlement(evidence: DpoVerifyResult): boolean {
    const match = /^(\d{4})[-/](\d{2})[-/](\d{2})$/.exec(
      evidence.settlementDate?.trim() ?? '',
    );
    if (!match) return false;
    const [, year, month, day] = match;
    const date = new Date(`${year}-${month}-${day}T00:00:00.000Z`);
    return (
      Number.isFinite(date.getTime()) &&
      date.toISOString().slice(0, 10) === `${year}-${month}-${day}` &&
      date.getTime() <= Date.now() &&
      this.usableNet(evidence)
    );
  }

  private usableNet(evidence: DpoVerifyResult): boolean {
    const net = evidence.netAmount?.trim() ?? '';
    return (
      /^\d+(?:\.\d+)?$/.test(net) &&
      /[1-9]/.test(net) &&
      (String(evidence.currency).toUpperCase() !== 'UGX' ||
        BigInt(net.split('.')[0]) > 0n)
    );
  }

  private fromEvidence(
    params: {
      token: string;
      paymentIntentId: string;
      evidence: DpoVerifyResult;
    },
    eventType: 'captured' | 'settled',
  ): ProviderEvent {
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
    if (
      evidence.netAmount?.trim() &&
      !/^\d+(?:\.\d+)?$/.test(evidence.netAmount.trim())
    )
      throw new ForbiddenException('DPO net amount is invalid');
    // DPO can report sub-shilling fees. Allocate only whole UGX to the campaign.
    const netAmount = this.usableNet(evidence)
      ? evidence.netAmount?.trim()
      : undefined;
    if (eventType === 'settled' && !netAmount)
      throw new ForbiddenException(
        'DPO settlement requires a positive net amount',
      );
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
      // Evidence can mature after payment (zero/missing net -> final net).
      // Do not let a permanently deduplicated earlier payload block fresh evidence.
      providerEventId: `${eventType === 'captured' ? 'verified-token' : 'verified-settlement'}:${params.token}:v2:${createHash(
        'sha256',
      )
        .update(
          `${grossMinor}:${netAmount ?? 'unknown'}:${evidence.settlementDate ?? ''}`,
        )
        .digest('hex')
        .slice(0, 24)}`,
      eventType,
      paymentIntentId: params.paymentIntentId,
      amountMinor: grossMinor,
      currency,
      ...(netAmount ? { providerFeeMinor: grossMinor - netMinor } : {}),
      receivedAt: new Date(),
    };
  }
}
