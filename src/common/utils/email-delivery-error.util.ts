/** Return only allowlisted diagnostics; never log a provider payload or recipient. */
export function emailDeliveryFailure(error: unknown): string {
  const candidate = error as {
    code?: unknown;
    response?: {
      statusCode?: unknown;
      body?: { errors?: Array<{ message?: unknown }> };
    };
  } | null;
  const status = candidate?.response?.statusCode ?? candidate?.code;
  const statusCode =
    typeof status === 'number' &&
    Number.isInteger(status) &&
    status >= 100 &&
    status <= 599
      ? String(status)
      : 'unknown';
  const messages = candidate?.response?.body?.errors;
  const text = Array.isArray(messages)
    ? messages
        .map((item) => (typeof item?.message === 'string' ? item.message : ''))
        .join(' ')
        .toLowerCase()
    : '';
  const reason = /sender identity|verified sender|from address/.test(text)
    ? 'sender_identity'
    : statusCode === '401' ||
        /api key|authorization|permission|unauthorized/.test(text)
      ? 'authorization'
      : statusCode === '429'
        ? 'rate_limit'
        : 'provider_rejected';
  return `status=${statusCode}; reason=${reason}`;
}
