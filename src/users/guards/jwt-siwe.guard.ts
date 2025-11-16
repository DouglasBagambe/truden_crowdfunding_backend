import {
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';

type SiweMetadata = {
  verified?: boolean;
};

type AuthenticatedUser = {
  siweVerified?: boolean;
  [key: string]: unknown;
};

type SiweRequest = Request & { siwe?: SiweMetadata };

@Injectable()
export class JwtSiweAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser extends AuthenticatedUser = AuthenticatedUser>(
    err: unknown,
    user: TUser | null,
    info: unknown,
    context: ExecutionContext,
    _status?: unknown,
  ): TUser {
    void _status;

    if (err) {
      if (err instanceof Error) {
        throw err;
      }
      throw new UnauthorizedException(
        typeof err === 'string' ? err : 'Unauthorized',
      );
    }

    if (!user) {
      throw new UnauthorizedException();
    }

    const request = context.switchToHttp().getRequest<SiweRequest>();
    const siweVerified = request.siwe?.verified ?? user.siweVerified ?? false;

    if (!siweVerified) {
      throw new UnauthorizedException('SIWE signature required');
    }

    return user;
  }
}
