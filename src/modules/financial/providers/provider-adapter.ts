import type { ProviderEvent } from '../financial.types';

export interface ProviderCallbackAdapter<TPayload, TEvidence = undefined> {
  readonly provider: string;
  isConfigured(): boolean;
  verifyAndNormalize(
    payload: TPayload,
    signature: string | undefined,
    evidence?: TEvidence,
  ): ProviderEvent;
}

export function decimalToMinor(value: unknown, currency: string): bigint {
  const scale = currency.toUpperCase() === 'UGX' ? 0 : 2;
  if (typeof value !== 'string' && typeof value !== 'number')
    throw new Error('Provider amount is invalid');
  const normalized = String(value).trim();
  const match = normalized.match(/^(\d+)(?:\.(\d+))?$/);
  if (!match) throw new Error('Provider amount is invalid');
  const fraction = (match[2] ?? '').padEnd(scale, '0');
  if (fraction.length > scale && /[1-9]/.test(fraction.slice(scale))) {
    throw new Error('Provider amount has unsupported precision');
  }
  return (
    BigInt(match[1]) * 10n ** BigInt(scale) +
    BigInt(fraction.slice(0, scale) || '0')
  );
}
