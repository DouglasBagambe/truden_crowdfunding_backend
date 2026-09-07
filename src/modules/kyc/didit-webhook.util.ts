import { ForbiddenException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';

type JsonRecord = Record<string, unknown>;

export type DiditWebhookInput = {
  body: JsonRecord;
  rawBody?: Buffer;
  signatureV2?: string;
  signatureV1?: string;
  signatureSimple?: string;
  timestamp?: string;
  secret: string;
  now?: Date;
};

function sortRecursively(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortRecursively);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as JsonRecord)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortRecursively(entry)]),
  );
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

function hmac(value: string | Buffer, secret: string): string {
  return createHmac('sha256', secret).update(value).digest('hex');
}

function signedField(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : '';
}

export function canonicalizeDiditBody(body: JsonRecord): string {
  return JSON.stringify(sortRecursively(body));
}

export function verifyDiditWebhook(input: DiditWebhookInput): {
  eventAt: Date;
  canonicalBody: string;
} {
  if (!input.timestamp) {
    throw new ForbiddenException('Missing webhook timestamp');
  }
  const timestampSeconds = Number(input.timestamp);
  if (!Number.isFinite(timestampSeconds)) {
    throw new ForbiddenException('Invalid webhook timestamp');
  }
  const eventAt = new Date(timestampSeconds * 1000);
  const now = input.now ?? new Date();
  if (Math.abs(now.getTime() - eventAt.getTime()) > 5 * 60 * 1000) {
    throw new ForbiddenException(
      'Webhook timestamp is outside the allowed window',
    );
  }

  const bodyTimestamp = Number(input.body.timestamp);
  if (!Number.isFinite(bodyTimestamp) || bodyTimestamp !== timestampSeconds) {
    throw new ForbiddenException(
      'Webhook timestamp does not match the signed payload',
    );
  }

  const canonicalBody = canonicalizeDiditBody(input.body);
  const v2Valid = Boolean(
    input.signatureV2 &&
      safeEqual(input.signatureV2, hmac(canonicalBody, input.secret)),
  );
  const v1Valid = Boolean(
    input.signatureV1 &&
      input.rawBody &&
      safeEqual(input.signatureV1, hmac(input.rawBody, input.secret)),
  );
  const simpleValue = [
    signedField(input.body.timestamp),
    signedField(input.body.session_id),
    signedField(input.body.status),
    signedField(input.body.webhook_type),
  ].join(':');
  const simpleValid = Boolean(
    input.signatureSimple &&
      safeEqual(input.signatureSimple, hmac(simpleValue, input.secret)),
  );

  if (!v2Valid && !v1Valid && !simpleValid) {
    throw new ForbiddenException('Invalid webhook signature');
  }
  return { eventAt, canonicalBody };
}
