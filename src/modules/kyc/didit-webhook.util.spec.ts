import { ForbiddenException } from '@nestjs/common';
import { createHmac } from 'crypto';
import {
  canonicalizeDiditBody,
  verifyDiditWebhook,
} from './didit-webhook.util';

const secret = 'didit-webhook-secret-for-unit-testing';
const now = new Date('2026-09-01T12:00:00.000Z');
const timestamp = String(Math.floor(now.getTime() / 1000));
const body = {
  status: 'Approved',
  timestamp: Number(timestamp),
  session_id: 'session-id',
  webhook_type: 'status.updated',
  decision: { name: 'José', score: 95 },
};

describe('Didit webhook verification', () => {
  it('accepts a fresh canonical V2 signature', () => {
    const canonical = canonicalizeDiditBody(body);
    const signatureV2 = createHmac('sha256', secret)
      .update(canonical)
      .digest('hex');
    const result = verifyDiditWebhook({
      body,
      signatureV2,
      timestamp,
      secret,
      now,
    });
    expect(result.eventAt).toEqual(now);
  });

  it('accepts an exact raw-body signature', () => {
    const rawBody = Buffer.from(JSON.stringify(body));
    const signatureV1 = createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');
    expect(
      verifyDiditWebhook({
        body,
        rawBody,
        signatureV1,
        timestamp,
        secret,
        now,
      }),
    ).toBeDefined();
  });

  it.each([
    ['bad signature', { signatureV2: 'invalid', timestamp }],
    ['stale timestamp', { signatureV2: 'invalid', timestamp: '1' }],
    ['header/body mismatch', { signatureV2: 'invalid', timestamp: '2' }],
  ])('rejects %s', (_case, values) => {
    expect(() => verifyDiditWebhook({ body, secret, now, ...values })).toThrow(
      ForbiddenException,
    );
  });
});
