import { ServiceUnavailableException } from '@nestjs/common';

/** Only controlled text may cross the provider -> job -> logs/API boundary. */
export class PayoutProviderError extends ServiceUnavailableException {
  readonly code: 'PROVIDER_RETRYABLE' | 'PROVIDER_PERMANENT';
  constructor(error: unknown, operation: string) {
    const candidate = error as {
      code?: unknown;
      response?: { status?: unknown; data?: { message?: unknown } };
    } | null;
    const status = candidate?.response?.status;
    const httpStatus =
      typeof status === 'number' &&
      Number.isInteger(status) &&
      status >= 100 &&
      status <= 599
        ? status
        : undefined;
    const networkCode =
      typeof candidate?.code === 'string' ? candidate.code : '';
    const retryable =
      httpStatus === 429 ||
      (httpStatus !== undefined && httpStatus >= 500) ||
      ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN'].includes(
        networkCode,
      );
    const raw = candidate?.response?.data?.message;
    const message =
      typeof raw === 'string' ? raw.slice(0, 2000).toLowerCase() : '';
    // Never persist arbitrary provider text: it can contain keys, names or account numbers.
    let reason =
      'Unrecognized provider rejection; provider investigation is required';
    if (httpStatus === 401) reason = 'API authentication was rejected';
    else if (httpStatus === 429) reason = 'Provider rate limit reached';
    else if (httpStatus !== undefined && httpStatus >= 500)
      reason = 'Provider service is temporarily unavailable';
    else if (/insufficient|not enough (funds|balance)/.test(message))
      reason = 'Insufficient provider payout balance or fee coverage';
    else if (/minimum|below.*limit|less than.*amount/.test(message))
      reason = 'Amount is below the provider minimum';
    else if (/maximum|exceed.*limit/.test(message))
      reason = 'Provider transaction limit exceeded';
    else if (/whitelist|white.list|ip address/.test(message))
      reason = 'Provider IP allowlist rejected the request';
    else if (
      /not enabled|not permitted|permission|not authorized|not authorised/.test(
        message,
      ) ||
      httpStatus === 403
    )
      reason = 'Provider permission or transfer activation is required';
    else if (/duplicate|already exist|reference.*used/.test(message))
      reason =
        'Provider reported a duplicate reference; reconcile before any retry';
    else if (
      /invalid.*(account|beneficiary|network)|beneficiary.*not found/.test(
        message,
      )
    )
      reason = 'Provider rejected the destination details';
    else if (retryable || networkCode === 'ECONNABORTED')
      reason =
        'Provider connection interrupted; transfer outcome must be reconciled';
    const code = retryable ? 'PROVIDER_RETRYABLE' : 'PROVIDER_PERMANENT';
    const safe = `Flutterwave ${operation} failed${httpStatus ? ` (HTTP ${httpStatus})` : ''}: ${reason}.`;
    super({ message: safe, code });
    this.message = safe;
    this.code = code;
  }
}
