import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { JwtPayload } from '../../../common/interfaces/user.interface';
import { AuthService } from '../auth.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    private authService: AuthService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey:
        configService.get<string>('JWT_SECRET') || 'default-secret-key',
    });
  }

  async validate(payload: JwtPayload): Promise<JwtPayload> {
    try {
      await this.authService.getProfile(payload.sub);
      return {
        sub: payload.sub,
        email: payload.email,
        walletAddress: payload.walletAddress,
        roles: payload.roles,
      };
    } catch (error) {
      throw new UnauthorizedException('User not found or inactive');
    }
  }
}
