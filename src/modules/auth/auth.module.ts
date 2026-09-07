import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { User, UserSchema } from '../users/schemas/user.schema';
import {
  RefreshToken,
  RefreshTokenSchema,
} from './schemas/refresh-token.schema';
import { RolesModule } from '../roles/roles.module';
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AuditModule } from '../audit/audit.module';
import { CommonModule } from '../../common/common.module';
import {
  WalletChallenge,
  WalletChallengeSchema,
} from './schemas/wallet-challenge.schema';
import { AuthCookieService } from './auth-cookie.service';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: RefreshToken.name, schema: RefreshTokenSchema },
      { name: WalletChallenge.name, schema: WalletChallengeSchema },
    ]),
    RolesModule,
    AuditModule,
    CommonModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const raw = configService.get<string>('JWT_EXPIRY') ?? '15m';
        const match = /^\s*(\d+)\s*([smhd])?\s*$/.exec(String(raw));
        let expiresIn: number;
        if (match) {
          const n = parseInt(match[1], 10);
          const u = match[2] ?? 's';
          const mult =
            u === 'd' ? 86400 : u === 'h' ? 3600 : u === 'm' ? 60 : 1;
          expiresIn = n * mult;
        } else {
          const n = Number(raw);
          expiresIn = Number.isFinite(n) ? n : 900;
        }
        return {
          secret: (() => {
            const secret = configService.get<string>('JWT_SECRET')?.trim();
            if (!secret) throw new Error('JWT_SECRET is required');
            return secret;
          })(),
          signOptions: { expiresIn },
        };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthCookieService,
    JwtStrategy,
    JwtAuthGuard,
    RolesGuard,
  ],
  exports: [AuthService, JwtAuthGuard, RolesGuard],
})
export class AuthModule {}
