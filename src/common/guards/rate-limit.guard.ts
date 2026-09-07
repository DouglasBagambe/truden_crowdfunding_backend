import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import crypto from 'crypto';
import type { Request, Response } from 'express';
import { RateLimitService } from '../services/rate-limit.service';
import { AuditService } from '../../modules/audit/audit.service';

type Rule = { pattern: RegExp; limit: number; windowMs: number; scope: string };

const RULES: Rule[] = [
  {
    pattern: /\/auth\/login(?:\/|$)/,
    limit: 5,
    windowMs: 60_000,
    scope: 'login',
  },
  {
    pattern: /\/auth\/register$/,
    limit: 3,
    windowMs: 600_000,
    scope: 'register',
  },
  {
    pattern: /\/auth\/(?:verify-email|resend-email)/,
    limit: 10,
    windowMs: 600_000,
    scope: 'verification',
  },
  {
    pattern: /\/auth\/(?:forgot-password|reset-password)/,
    limit: 5,
    windowMs: 3_600_000,
    scope: 'recovery',
  },
  { pattern: /\/auth\/mfa\//, limit: 8, windowMs: 300_000, scope: 'mfa' },
  {
    pattern: /\/auth\/siwe\/nonce/,
    limit: 10,
    windowMs: 300_000,
    scope: 'wallet',
  },
  {
    pattern: /\/users\/me\/wallets/,
    limit: 10,
    windowMs: 300_000,
    scope: 'wallet',
  },
  {
    pattern: /\/kyc\/webhook\//,
    limit: 120,
    windowMs: 60_000,
    scope: 'kyc-webhook',
  },
  {
    pattern: /\/payments\/(?:webhook|payout-callback|dpo\/webhook)/,
    limit: 120,
    windowMs: 60_000,
    scope: 'payment-webhook',
  },
  {
    pattern: /\/payments\/(?:verify|dpo\/verify)/,
    limit: 30,
    windowMs: 60_000,
    scope: 'payment-verification',
  },
  {
    pattern: /\/(?:admin\/|\/admin)/,
    limit: 60,
    windowMs: 60_000,
    scope: 'administration',
  },
];

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly limiter: RateLimitService,
    private readonly auditService: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();
    const rule = RULES.find((candidate) =>
      candidate.pattern.test(request.path),
    );
    if (!rule) return true;

    const user = (
      request as Request & {
        user?: { sub?: string; roles?: string[] };
      }
    ).user;
    const email =
      typeof (request.body as { email?: unknown } | undefined)?.email ===
      'string'
        ? String((request.body as { email: string }).email)
            .trim()
            .toLowerCase()
        : '';
    const identity =
      user?.sub ||
      email ||
      request.ip ||
      request.socket.remoteAddress ||
      'unknown';
    const key = crypto.createHash('sha256').update(identity).digest('hex');
    const result = await this.limiter.consume(
      rule.scope,
      key,
      rule.limit,
      rule.windowMs,
    );
    if (result.allowed) return true;

    response.setHeader('Retry-After', String(result.retryAfterSeconds));
    if (user?.sub) {
      await this.auditService.log({
        action: 'security.rate_limit.exceeded',
        actorId: user.sub,
        actorRoles: user.roles ?? [],
        targetType: 'route_scope',
        targetId: rule.scope,
      });
    }
    throw new HttpException('Too many requests', HttpStatus.TOO_MANY_REQUESTS);
  }
}
