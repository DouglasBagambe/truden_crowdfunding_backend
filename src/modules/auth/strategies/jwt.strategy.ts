import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-jwt';
import type { Request } from 'express';
import { ConfigService } from '@nestjs/config';
import { JwtPayload } from '../../../common/interfaces/user.interface';
import { AuthService } from '../auth.service';

function extractJwtFromAuthHeader(req: Request): string | null {
  const cookieToken = req.cookies?.keibo_access as string | undefined;
  if (cookieToken) return cookieToken;
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;
  const [scheme, token] = authHeader.split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  return token;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    private authService: AuthService,
  ) {
    super({
      jwtFromRequest: extractJwtFromAuthHeader,
      ignoreExpiration: false,
      secretOrKey: (() => {
        const secret = configService.get<string>('JWT_SECRET')?.trim();
        if (!secret) throw new Error('JWT_SECRET is required');
        return secret;
      })(),
      issuer: configService.get<string>('JWT_ISSUER') || undefined,
      audience: configService.get<string>('JWT_AUDIENCE') || undefined,
    });
  }

  async validate(payload: JwtPayload): Promise<JwtPayload> {
    if (payload.typ !== 'access') {
      throw new UnauthorizedException('Invalid session token');
    }
    try {
      const profile = (await this.authService.getProfile(payload.sub)) as {
        email?: string;
        primaryWallet?: string;
        walletAddress?: string;
        roles?: JwtPayload['roles'];
        permissions?: JwtPayload['permissions'];
      };
      return {
        sub: payload.sub,
        email: profile.email ?? payload.email,
        primaryWallet: profile.primaryWallet ?? payload.primaryWallet,
        walletAddress:
          profile.walletAddress ??
          profile.primaryWallet ??
          payload.walletAddress ??
          payload.primaryWallet,
        roles:
          Array.isArray(profile.roles) && profile.roles.length > 0
            ? profile.roles
            : payload.roles,
        permissions:
          Array.isArray(profile.permissions) && profile.permissions.length > 0
            ? profile.permissions
            : payload.permissions,
      };
    } catch {
      throw new UnauthorizedException('User not found or inactive');
    }
  }
}
