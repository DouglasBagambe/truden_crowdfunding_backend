import { PaymentStatus } from './schemas/payment-transaction.schema';

export interface DpoIncomingFeeConfig {
  dpoFeeBps: number;
  dpoVatBps: number;
  keiboFeeBps: number;
}

export interface DpoIncomingQuote {
  currency: string;
  requestedAmount: number;
  grossAmount: number;
  dpoFee: number;
  dpoVat: number;
  keiboFee: number;
  providerNetAmount: number;
  projectNetAmount: number;
  roundingAdjustment: number;
}

export interface DpoResultDisposition {
  paymentStatus: PaymentStatus;
  terminal: boolean;
  isProviderError: boolean;
}

const DEFAULT_DPO_FEE_BPS = 250;
const DEFAULT_DPO_VAT_BPS = 1800;
const DEFAULT_KEIBO_FEE_BPS = 0;

const DPO_PENDING_CODES = new Set(['001', '002', '003', '005', '007', '900']);
const DPO_FAILED_CODES = new Set(['901', '904']);
const DPO_CANCELLED_CODES = new Set(['903']);
const DPO_PROVIDER_ERROR_CODES = new Set(['801', '802', '803', '804', '950']);

export function getCurrencyScale(currency: string): number {
  return currency.toUpperCase() === 'UGX' ? 0 : 2;
}

function roundToScale(value: number, scale: number, mode: 'round' | 'ceil'): number {
  const factor = 10 ** scale;
  const scaled = value * factor;
  const rounded = mode === 'ceil' ? Math.ceil(scaled - Number.EPSILON) : Math.round(scaled);
  return rounded / factor;
}

export function roundCurrency(value: number, currency: string): number {
  return roundToScale(value, getCurrencyScale(currency), 'round');
}

export function ceilCurrency(value: number, currency: string): number {
  return roundToScale(value, getCurrencyScale(currency), 'ceil');
}

export function smallestCurrencyUnit(currency: string): number {
  return 1 / 10 ** getCurrencyScale(currency);
}

export function parseBps(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  return Math.round(parsed);
}

export function resolveIncomingFeeConfig(source: {
  dpoFeeBps?: string;
  dpoVatBps?: string;
  keiboFeeBps?: string;
}): DpoIncomingFeeConfig {
  return {
    dpoFeeBps: parseBps(source.dpoFeeBps, DEFAULT_DPO_FEE_BPS),
    dpoVatBps: parseBps(source.dpoVatBps, DEFAULT_DPO_VAT_BPS),
    keiboFeeBps: parseBps(source.keiboFeeBps, DEFAULT_KEIBO_FEE_BPS),
  };
}

export function calculateDpoIncomingQuote(params: {
  requestedAmount: number;
  currency: string;
  config: DpoIncomingFeeConfig;
}): DpoIncomingQuote {
  const currency = params.currency.toUpperCase();
  const requestedAmount = ceilCurrency(params.requestedAmount, currency);
  const providerRate =
    params.config.dpoFeeBps / 10_000 +
    (params.config.dpoFeeBps / 10_000) * (params.config.dpoVatBps / 10_000);
  const keiboRate = params.config.keiboFeeBps / 10_000;
  const totalRate = providerRate + keiboRate;

  if (requestedAmount <= 0) {
    throw new Error('Requested amount must be greater than zero');
  }

  if (totalRate >= 1) {
    throw new Error('Configured inbound fee rates are invalid');
  }

  const unit = smallestCurrencyUnit(currency);
  let grossAmount = ceilCurrency(requestedAmount / (1 - totalRate), currency);

  for (let attempt = 0; attempt < 10_000; attempt += 1) {
    const dpoFee = ceilCurrency(grossAmount * (params.config.dpoFeeBps / 10_000), currency);
    const dpoVat = ceilCurrency(dpoFee * (params.config.dpoVatBps / 10_000), currency);
    const keiboFee = ceilCurrency(grossAmount * (params.config.keiboFeeBps / 10_000), currency);
    const providerNetAmount = roundCurrency(grossAmount - dpoFee - dpoVat, currency);
    const projectNetAmount = roundCurrency(providerNetAmount - keiboFee, currency);

    if (projectNetAmount >= requestedAmount) {
      return {
        currency,
        requestedAmount,
        grossAmount,
        dpoFee,
        dpoVat,
        keiboFee,
        providerNetAmount,
        projectNetAmount,
        roundingAdjustment: roundCurrency(projectNetAmount - requestedAmount, currency),
      };
    }

    grossAmount = ceilCurrency(grossAmount + unit, currency);
  }

  throw new Error('Unable to calculate a stable DPO incoming quote');
}

export function normalizeDpoResult(resultCode: string | undefined): DpoResultDisposition {
  const normalizedCode = String(resultCode || '').trim();

  if (normalizedCode === '000') {
    return {
      paymentStatus: PaymentStatus.Successful,
      terminal: true,
      isProviderError: false,
    };
  }

  if (DPO_PENDING_CODES.has(normalizedCode) || !normalizedCode) {
    return {
      paymentStatus: PaymentStatus.Pending,
      terminal: false,
      isProviderError: false,
    };
  }

  if (DPO_CANCELLED_CODES.has(normalizedCode)) {
    return {
      paymentStatus: PaymentStatus.Cancelled,
      terminal: true,
      isProviderError: false,
    };
  }

  if (DPO_PROVIDER_ERROR_CODES.has(normalizedCode)) {
    return {
      paymentStatus: PaymentStatus.Failed,
      terminal: true,
      isProviderError: true,
    };
  }

  if (DPO_FAILED_CODES.has(normalizedCode)) {
    return {
      paymentStatus: PaymentStatus.Failed,
      terminal: true,
      isProviderError: false,
    };
  }

  return {
    paymentStatus: PaymentStatus.Pending,
    terminal: false,
    isProviderError: false,
  };
}

export function parseProviderAmount(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return parsed;
}

export function amountsMatch(params: {
  expected: number;
  actual: number | null;
  currency: string;
}): boolean {
  if (params.actual === null) {
    return false;
  }

  const tolerance = smallestCurrencyUnit(params.currency);
  return Math.abs(roundCurrency(params.expected, params.currency) - roundCurrency(params.actual, params.currency)) <= tolerance;
}
