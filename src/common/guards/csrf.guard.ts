import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import crypto from 'crypto';
import type { Request } from 'express';
import { IS_CSRF_EXEMPT } from '../decorators/csrf-exempt.decorator';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly configService: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const exempt = this.reflector.getAllAndOverride<boolean>(IS_CSRF_EXEMPT, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (exempt) return true;

    const request = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(request.method.toUpperCase())) return true;

    const cookieToken = request.cookies?.keibo_csrf as string | undefined;
    const headerToken = request.header('x-csrf-token');
    if (
      !cookieToken ||
      !headerToken ||
      !this.safeEqual(cookieToken, headerToken)
    ) {
      throw new ForbiddenException('CSRF validation failed');
    }

    const [random, signature] = cookieToken.split('.');
    if (!random || !signature)
      throw new ForbiddenException('CSRF validation failed');
    const secret = this.configService.get<string>('CSRF_SECRET');
    if (!secret) throw new ForbiddenException('CSRF protection is unavailable');
    const expected = crypto
      .createHmac('sha256', secret)
      .update(random)
      .digest('base64url');
    if (!this.safeEqual(signature, expected)) {
      throw new ForbiddenException('CSRF validation failed');
    }
    return true;
  }

  private safeEqual(left: string, right: string): boolean {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
}
