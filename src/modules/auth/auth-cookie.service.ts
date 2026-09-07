import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import crypto from 'crypto';
import type { CookieOptions, Response } from 'express';

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthCookieService {
  constructor(private readonly configService: ConfigService) {}

  setSession(response: Response, tokens: SessionTokens): string {
    response.cookie('keibo_access', tokens.accessToken, {
      ...this.baseOptions(),
      httpOnly: true,
      path: '/api',
      maxAge: this.durationMs(this.configService.get('JWT_EXPIRY') || '15m'),
    });
    response.cookie('keibo_refresh', tokens.refreshToken, {
      ...this.baseOptions(),
      httpOnly: true,
      path: '/api/auth',
      maxAge: this.durationMs(
        this.configService.get('REFRESH_TOKEN_EXPIRY') || '7d',
      ),
    });
    return this.setCsrf(response);
  }

  setCsrf(response: Response): string {
    const random = crypto.randomBytes(24).toString('base64url');
    const secret = this.configService.get<string>('CSRF_SECRET');
    if (!secret) throw new Error('CSRF_SECRET is required');
    const signature = crypto
      .createHmac('sha256', secret)
      .update(random)
      .digest('base64url');
    const token = `${random}.${signature}`;
    response.cookie('keibo_csrf', token, {
      ...this.baseOptions(),
      httpOnly: false,
      path: '/api',
      maxAge: this.durationMs(
        this.configService.get('REFRESH_TOKEN_EXPIRY') || '7d',
      ),
    });
    return token;
  }

  clearSession(response: Response): void {
    response.clearCookie('keibo_access', {
      ...this.baseOptions(),
      path: '/api',
    });
    response.clearCookie('keibo_refresh', {
      ...this.baseOptions(),
      path: '/api/auth',
    });
    response.clearCookie('keibo_csrf', { ...this.baseOptions(), path: '/api' });
  }

  private baseOptions(): CookieOptions {
    const sameSite =
      (
        this.configService.get<string>('COOKIE_SAME_SITE') || 'lax'
      ).toLowerCase() === 'strict'
        ? 'strict'
        : 'lax';
    const domain = this.configService.get<string>('COOKIE_DOMAIN')?.trim();
    return {
      secure:
        this.configService.get<string>('COOKIE_SECURE') === 'true' ||
        this.configService.get<string>('NODE_ENV') === 'production',
      sameSite,
      ...(domain ? { domain } : {}),
    };
  }

  private durationMs(value: string | number): number {
    if (typeof value === 'number') return value * 1000;
    const match = /^(\d+)([smhd])$/.exec(value);
    if (!match) throw new Error('Session expiry must use s, m, h or d units');
    const units: Record<string, number> = {
      s: 1000,
      m: 60_000,
      h: 3_600_000,
      d: 86_400_000,
    };
    return Number(match[1]) * units[match[2]];
  }
}
