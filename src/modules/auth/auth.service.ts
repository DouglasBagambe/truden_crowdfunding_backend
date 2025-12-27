import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  Logger,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import sgMail from '@sendgrid/mail';
import { TokenExpiredError } from 'jsonwebtoken';
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';
import geoip from 'geoip-lite';
import crypto from 'crypto';
import * as speakeasy from 'speakeasy';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { OAuthLoginDto, AuthProvider } from './dto/oauth-login.dto';
import { JwtPayload } from '../../common/interfaces/user.interface';
import { UserRole } from '../../common/enums/role.enum';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  RefreshToken,
  RefreshTokenDocument,
} from './schemas/refresh-token.schema';
import { RolesService } from '../roles/roles.service';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly rateLimits = new Map<
    string,
    { count: number; resetAt: number }
  >();
  private readonly appleJwks = createRemoteJWKSet(
    new URL('https://appleid.apple.com/auth/keys'),
  );
  private readonly emailVerificationWindowMs = 60 * 60 * 1000; // 1 hour
  private readonly emailVerificationMaxSends = 3;
  private readonly emailVerificationMaxAttempts = 5;
  private readonly emailVerificationBlockMs = 10 * 60 * 1000; // 10 minutes

  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(RefreshToken.name)
    private refreshTokenModel: Model<RefreshTokenDocument>,
    private jwtService: JwtService,
    private configService: ConfigService,
    private rolesService: RolesService,
    private readonly auditService: AuditService,
  ) {}

  async register(registerDto: RegisterDto, ipAddress?: string) {
    const { email, password, firstName, lastName, role } = registerDto;
    this.enforceRateLimit('register', email, 3, 10 * 60 * 1000);
    this.enforceRateLimitForIp('register', ipAddress, 20, 10 * 60 * 1000);
    const isTestEnv = this.configService.get<string>('NODE_ENV') === 'test';

    const existingUser = await this.userModel
      .findOne({ email: email.toLowerCase() })
      .exec();
    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await this.userModel.create({
      email: email.toLowerCase(),
      passwordHash,
      authProvider: AuthProvider.EMAIL,
      signupIp: ipAddress,
      lastLoginIp: ipAddress,
      lastLoginAt: new Date(),
      emailVerifiedAt: isTestEnv ? new Date() : null,
      emailVerificationSentAt: undefined,
      emailVerificationSendCount: 0,
      emailVerificationRateLimitResetAt: undefined,
      roles: role ? [role] : [UserRole.INVESTOR],
      isActive: true,
      isBlocked: false,
      profile: {
        firstName,
        lastName,
        displayName:
          [firstName, lastName].filter(Boolean).join(' ').trim() || email,
      },
    });

    const tokens = await this.generateTokens(user);
    if (!isTestEnv) {
      await this.issueVerificationCode(user, {
        sendCount: 1,
        rateLimitReset: Date.now() + this.emailVerificationWindowMs,
        resetAttempts: true,
      });
    }

    const permissions = await this.rolesService.getPermissionsForRoles(
      user.roles,
    );

    return {
      user: { ...this.sanitizeUser(user), permissions },
      ...tokens,
    };
  }

  async login(loginDto: LoginDto, ipAddress?: string) {
    const { email, password } = loginDto;
    this.enforceRateLimit('login', email, 5, 60 * 1000);
    this.enforceRateLimitForIp('login', ipAddress, 30, 10 * 60 * 1000);

    const user = await this.userModel
      .findOne({ email: email.toLowerCase() })
      .select('+passwordHash +mfa.secret +mfa.setupSecret')
      .exec();
    const provider = user?.authProvider as AuthProvider | undefined;
    if (!user || !user.passwordHash || provider !== AuthProvider.EMAIL) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const roles = Array.isArray(user.roles) ? user.roles : [];
    const isAdmin = roles.includes(UserRole.ADMIN) || roles.includes(UserRole.SUPERADMIN);
    if (isAdmin) {
      const allowedIps = this.getAdminAllowedIps();
      if (allowedIps && ipAddress && !allowedIps.has(ipAddress)) {
        throw new UnauthorizedException('Admin login not allowed from this IP');
      }
      if (!user.mfa?.enabled) {
        throw new UnauthorizedException('Admin MFA required');
      }
    }

    const requiresMfa = this.requiresMfa(user);
    if (requiresMfa) {
      if (!loginDto.otp) {
        throw new UnauthorizedException('MFA code required');
      }
      const secret = user.mfa?.secret;
      const valid = secret ? this.verifyTotp(secret, loginDto.otp) : false;
      if (!valid) {
        throw new UnauthorizedException('Invalid MFA code');
      }
    }

    const isTestEnv = this.configService.get<string>('NODE_ENV') === 'test';
    if (!user.emailVerifiedAt && !isTestEnv) {
      throw new UnauthorizedException('Email not verified');
    }

    if (!user.isActive || user.isBlocked) {
      throw new UnauthorizedException('Account is deactivated');
    }

    await this.userModel
      .findByIdAndUpdate(user._id, {
        lastLoginAt: new Date(),
        ...(ipAddress ? { lastLoginIp: ipAddress } : {}),
      })
      .exec();

    const permissions = await this.rolesService.getPermissionsForRoles(
      user.roles,
    );
    const tokens = await this.generateTokens(user, { ip: ipAddress });

    await this.auditService.log({
      action: 'auth.login',
      actorId: String(user._id),
      actorRoles: user.roles ?? [],
      targetType: 'user',
      targetId: String(user._id),
      metadata: { provider: AuthProvider.EMAIL },
      ip: ipAddress,
    });

    return {
      user: { ...this.sanitizeUser(user), permissions },
      ...tokens,
    };
  }

  async oauthLogin(dto: OAuthLoginDto, ipAddress?: string) {
    this.enforceRateLimit(
      'oauthLogin',
      dto.idToken.slice(-12),
      10,
      5 * 60 * 1000,
    );
    const provider = dto.provider;
    if (![AuthProvider.GOOGLE, AuthProvider.APPLE].includes(provider)) {
      throw new BadRequestException('Unsupported provider');
    }
    const decoded =
      provider === AuthProvider.GOOGLE
        ? await this.verifyGoogleIdToken(dto.idToken)
        : await this.verifyAppleIdToken(dto.idToken);
    const now = Math.floor(Date.now() / 1000);
    const exp =
      typeof decoded.exp === 'number'
        ? decoded.exp
        : typeof decoded.exp === 'string'
          ? Number(decoded.exp)
          : undefined;
    if (exp && exp < now) {
      throw new UnauthorizedException('Token expired');
    }
    if (provider === AuthProvider.GOOGLE) {
      const aud = this.configService.get<string>('GOOGLE_CLIENT_ID');
      const audClaim = decoded.aud;
      const audMismatch =
        !!aud &&
        ((typeof audClaim === 'string' && audClaim !== aud) ||
          (Array.isArray(audClaim) && !audClaim.includes(aud)) ||
          (!audClaim && !!aud));
      if (audMismatch) {
        throw new UnauthorizedException('Invalid Google audience');
      }
      if (
        typeof decoded.iss === 'string' &&
        decoded.iss !== 'accounts.google.com' &&
        decoded.iss !== 'https://accounts.google.com'
      ) {
        throw new UnauthorizedException('Invalid Google issuer');
      }
    }
    if (provider === AuthProvider.APPLE) {
      const aud = this.configService.get<string>('APPLE_CLIENT_ID');
      const audClaim = decoded.aud;
      const audMismatch =
        !!aud &&
        ((typeof audClaim === 'string' && audClaim !== aud) ||
          (Array.isArray(audClaim) && !audClaim.includes(aud)) ||
          (!audClaim && !!aud));
      if (audMismatch) {
        throw new UnauthorizedException('Invalid Apple audience');
      }
      if (
        typeof decoded.iss === 'string' &&
        decoded.iss !== 'https://appleid.apple.com'
      ) {
        throw new UnauthorizedException('Invalid Apple issuer');
      }
    }

    const emailVerified =
      decoded.email_verified === true || decoded.email_verified === 'true';
    const providerSubject =
      typeof decoded.sub === 'string' ? decoded.sub : dto.idToken;
    const email =
      typeof decoded.email === 'string'
        ? decoded.email.toLowerCase()
        : undefined;
    const decodedDisplayName =
      typeof decoded.name === 'string'
        ? decoded.name
        : [decoded.given_name, decoded.family_name]
            .filter((val): val is string => typeof val === 'string')
            .join(' ')
            .trim();
    const displayName = decodedDisplayName || email || providerSubject;
    const locale =
      typeof decoded.locale === 'string' ? decoded.locale : undefined;
    const geoCountry = this.lookupCountryFromIp(ipAddress);

    let user = await this.userModel
      .findOne({
        $or: [
          { oauthProviderId: providerSubject, authProvider: provider },
          ...(email ? [{ email }] : []),
        ],
      })
      .exec();

    if (!user) {
      user = await this.userModel.create({
        authProvider: provider,
        oauthProviderId: providerSubject,
        email,
        emailVerifiedAt: emailVerified ? new Date() : undefined,
        roles: [UserRole.INVESTOR],
        isActive: true,
        isBlocked: false,
        signupIp: ipAddress,
        lastLoginIp: ipAddress,
        lastLoginAt: new Date(),
        profile: {
          displayName,
          country: geoCountry,
          locale,
        },
      });
    } else if (!user.isActive || user.isBlocked) {
      throw new UnauthorizedException('Account is deactivated');
    } else {
      const update: Record<string, unknown> = { lastLoginAt: new Date() };
      if (ipAddress) {
        update.lastLoginIp = ipAddress;
      }
      if (emailVerified && !user.emailVerifiedAt) {
        update.emailVerifiedAt = new Date();
      }
      if (geoCountry && !user.profile?.country) {
        update['profile.country'] = geoCountry;
      }
      if (locale && !user.profile?.locale) {
        update['profile.locale'] = locale;
      }
      await this.userModel.findByIdAndUpdate(user._id, update).exec();
    }

    const permissions = await this.rolesService.getPermissionsForRoles(
      user.roles,
    );
    const tokens = await this.generateTokens(user);

    await this.auditService.log({
      action: 'auth.login',
      actorId: String(user._id),
      actorRoles: user.roles ?? [],
      targetType: 'user',
      targetId: String(user._id),
      metadata: { provider },
      ip: ipAddress,
    });

    return {
      user: { ...this.sanitizeUser(user), permissions },
      ...tokens,
    };
  }

  async verifyEmail(dto: { code?: string; email?: string }) {
    const rawCode = dto.code?.trim();
    const hasCode = !!rawCode;
    const normalizedEmail = dto.email?.trim().toLowerCase();

    if (!hasCode) {
      throw new BadRequestException('Verification code is required');
    }
    this.enforceRateLimit('verifyEmail', rawCode.slice(-12), 10, 5 * 60 * 1000);

    // Prefer code flow when provided
    if (hasCode) {
      if (!normalizedEmail) {
        throw new BadRequestException(
          'Email is required when using code verification',
        );
      }
      const now = new Date();
      const user: UserDocument | null = await this.userModel
        .findOne({ email: normalizedEmail })
        .select(
          '+emailVerificationCodeHash +emailVerificationAttempts +emailVerificationBlockedUntil +emailVerificationCodeExpiresAt',
        )
        .exec();
      if (user?.emailVerifiedAt) {
        return {
          message: 'Email already verified',
          user: this.sanitizeUser(user),
        };
      }
      const hashedInput = this.hashCode(rawCode);
      if (
        user?.emailVerificationBlockedUntil &&
        user.emailVerificationBlockedUntil > now
      ) {
        throw new HttpException(
          'Too many attempts. Try again later.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      const missingCode =
        !user?.emailVerificationCodeHash ||
        !user.emailVerificationCodeExpiresAt;
      const codeExpired =
        !!user?.emailVerificationCodeExpiresAt &&
        user.emailVerificationCodeExpiresAt <= now;
      const codeMismatch =
        !user || user.emailVerificationCodeHash !== hashedInput;

      if (missingCode || codeExpired || codeMismatch) {
        if (user) {
          const attempts = Number(user.emailVerificationAttempts ?? 0) + 1;
          const update: Record<string, unknown> = {
            emailVerificationAttempts: attempts,
          };
          if (attempts >= this.emailVerificationMaxAttempts) {
            update.emailVerificationBlockedUntil = new Date(
              now.getTime() + this.emailVerificationBlockMs,
            );
          }
          await this.userModel
            .findByIdAndUpdate(user._id, update, { new: false })
            .exec();
        }
        throw new UnauthorizedException('Invalid or expired verification code');
      }

      const updated = await this.userModel
        .findByIdAndUpdate(
          user._id,
          {
            emailVerifiedAt: new Date(),
            emailVerificationCodeHash: undefined,
            emailVerificationCodeExpiresAt: undefined,
            emailVerificationAttempts: 0,
            emailVerificationBlockedUntil: undefined,
          },
          { new: true },
        )
        .exec();

      return { message: 'Email verified', user: this.sanitizeUser(updated!) };
    }

    // Legacy token path removed
  }

  async resendVerificationEmail(email: string, ipAddress?: string) {
    const normalizedEmail = email.trim().toLowerCase();
    const isTestEnv = this.configService.get<string>('NODE_ENV') === 'test';
    if (isTestEnv) {
      return { message: 'Verification email sent' };
    }
    this.enforceRateLimit('resendEmail', normalizedEmail, 3, this.emailVerificationWindowMs);
    this.enforceRateLimitForIp('resendEmail', ipAddress, 10, this.emailVerificationWindowMs);

    const user = await this.userModel
      .findOne({ email: normalizedEmail })
      .exec();
    if (!user) {
      // Avoid account enumeration
      return {
        message: 'If an account exists, a verification email will be sent.',
      };
    }
    if (user.emailVerifiedAt) {
      return { message: 'Email already verified' };
    }

    const { count, nextReset } = this.assertSendWithinWindow(
      user,
      'emailVerificationSendCount',
      'emailVerificationRateLimitResetAt',
      this.emailVerificationMaxSends,
      this.emailVerificationWindowMs,
    );

    await this.issueVerificationCode(user, {
      sendCount: count + 1,
      rateLimitReset: nextReset,
      resetAttempts: true,
    });

    return {
      message: 'Verification email sent',
    };
  }

  async forgotPassword(email: string, ipAddress?: string) {
    const normalizedEmail = email.trim().toLowerCase();
    this.enforceRateLimit('forgotPassword', normalizedEmail, 3, 60 * 60 * 1000);
    this.enforceRateLimitForIp('forgotPassword', ipAddress, 10, 60 * 60 * 1000);
    const user = await this.userModel
      .findOne({ email: normalizedEmail })
      .select('+passwordHash')
      .exec();

    if (!user) {
      return { message: 'If an account exists, a reset email will be sent.' };
    }

    const { count, nextReset } = this.assertSendWithinWindow(
      user,
      'passwordResetSendCount',
      'passwordResetRateLimitResetAt',
      3,
      60 * 60 * 1000,
    );

    const resetToken = await this.createPasswordResetToken(user);
    await this.sendPasswordResetEmail(user.email, resetToken);
    await this.userModel
      .findByIdAndUpdate(user._id, {
        passwordResetSentAt: new Date(),
        passwordResetSendCount: count + 1,
        passwordResetRateLimitResetAt: new Date(nextReset),
      })
      .exec();

    return { message: 'If an account exists, a reset email will be sent.' };
  }

  async resetPassword(token: string, newPassword: string) {
    this.enforceRateLimit('resetPassword', token.slice(-12), 5, 10 * 60 * 1000);
    try {
      const payload = this.jwtService.verify<{ sub: string }>(token, {
        secret:
          this.configService.get<string>('PASSWORD_RESET_SECRET') ||
          this.configService.get<string>('JWT_SECRET'),
      });
      const user = await this.userModel
        .findById(payload.sub)
        .select('+passwordHash')
        .exec();
      if (!user || !user.isActive || user.isBlocked) {
        throw new UnauthorizedException('Invalid reset token');
      }
      const passwordHash = await bcrypt.hash(newPassword, 10);
      await this.userModel
        .findByIdAndUpdate(user._id, {
          passwordHash,
          passwordUpdatedAt: new Date(),
        })
        .exec();
      await this.revokeAllRefreshTokensForUser(String(user._id));
      return { message: 'Password reset successful' };
    } catch (err: unknown) {
      if (err instanceof TokenExpiredError) {
        throw new BadRequestException('Reset token expired');
      }
      throw new UnauthorizedException('Invalid reset token');
    }
  }

  async getProfile(userId: string) {
    const user = await this.userModel.findById(userId).exec();
    if (!user || !user.isActive || user.isBlocked) {
      throw new UnauthorizedException('User not found or inactive');
    }
    const permissions = await this.rolesService.getPermissionsForRoles(
      user.roles,
    );
    return { ...this.sanitizeUser(user), permissions };
  }

  async logout(userId: string) {
    await this.revokeAllRefreshTokensForUser(userId);
    return { message: 'Logged out successfully' };
  }

  async refreshToken(refreshToken: string) {
    try {
      const payload = this.jwtService.verify<{ sub: string; jti?: string }>(
        refreshToken,
        {
          secret: this.configService.get<string>('REFRESH_TOKEN_SECRET'),
          issuer: this.getIssuer(),
          audience: this.getAudience(),
        },
      );

      if (!payload.jti) {
        throw new UnauthorizedException('Invalid refresh token: missing jti');
      }

      const tokenHash = this.hashToken(refreshToken);
      const record = await this.refreshTokenModel
        .findOne({
          userId: payload.sub,
          jti: payload.jti,
        })
        .exec();

      if (!record || record.revoked || record.tokenHash !== tokenHash) {
        throw new UnauthorizedException('Invalid refresh token');
      }
      if (record.expiresAt.getTime() <= Date.now()) {
        throw new UnauthorizedException('Refresh token expired');
      }

      // rotate: revoke old token
      await this.refreshTokenModel.updateOne(
        { _id: record._id },
        { $set: { revoked: true, revokedAt: new Date() } },
      );

      const user = await this.userModel.findById(payload.sub).exec();
      if (!user || !user.isActive || user.isBlocked) {
        throw new UnauthorizedException('User not found or inactive');
      }

      const tokens = await this.generateTokens(user);
      const permissions = await this.rolesService.getPermissionsForRoles(
        user.roles,
      );
      return { ...tokens, permissions };
    } catch (error) {
      throw new UnauthorizedException(
        'Invalid refresh token: ' + (error as Error).message,
      );
    }
  }

  async startMfaSetup(userId: string) {
    const user = await this.userModel.findById(userId).exec();
    if (!user) {
      throw new UnauthorizedException('User not found');
    }
    const secret = speakeasy.generateSecret({
      length: 20,
      name: `Truden (${user.email ?? userId})`,
    });
    user.mfa = {
      ...(user.mfa || {}),
      setupSecret: secret.base32,
      enabled: user.mfa?.enabled ?? false,
    };
    await user.save();
    return {
      secret: secret.base32,
      otpauthUrl: secret.otpauth_url,
      note: 'Scan in authenticator app, then call /auth/mfa/enable with the 6-digit code.',
    };
  }

  async enableMfa(userId: string, token: string) {
    const user = await this.userModel
      .findById(userId)
      .select('+mfa.secret +mfa.setupSecret')
      .exec();
    if (!user) throw new UnauthorizedException('User not found');
    const secret = user.mfa?.setupSecret;
    if (!secret) {
      throw new BadRequestException('No MFA setup in progress');
    }
    const verified = this.verifyTotp(secret, token);
    if (!verified) {
      throw new UnauthorizedException('Invalid MFA code');
    }
    user.mfa = {
      enabled: true,
      secret,
      setupSecret: undefined,
      verifiedAt: new Date(),
    };
    await user.save();
    return { message: 'MFA enabled' };
  }

  async disableMfa(userId: string, token: string) {
    const user = await this.userModel
      .findById(userId)
      .select('+mfa.secret +mfa.setupSecret')
      .exec();
    if (!user) throw new UnauthorizedException('User not found');
    const secret = user.mfa?.secret;
    if (!secret || !user.mfa?.enabled) {
      throw new BadRequestException('MFA is not enabled');
    }
    const verified = this.verifyTotp(secret, token);
    if (!verified) {
      throw new UnauthorizedException('Invalid MFA code');
    }
    user.mfa = {
      enabled: false,
      secret: undefined,
      setupSecret: undefined,
      verifiedAt: undefined,
    };
    await user.save();
    return { message: 'MFA disabled' };
  }

  private async generateTokens(
    user: UserDocument,
    options: { ip?: string; userAgent?: string } = {},
  ) {
    const roles = Array.isArray(user.roles) ? user.roles : [];
    const permissions = await this.rolesService.getPermissionsForRoles(roles);
    const jti = crypto.randomUUID();
    const payload: JwtPayload = {
      sub: String(user._id),
      email: user.email,
      primaryWallet: user.primaryWallet,
      walletAddress: user.primaryWallet,
      roles,
      permissions,
      jti,
    };

    const accessExpiresIn = (this.configService.get<string>('JWT_EXPIRY') ||
      '15m') as JwtSignOptions['expiresIn'];
    const refreshExpiresIn = (this.configService.get<string>(
      'REFRESH_TOKEN_EXPIRY',
    ) || '7d') as JwtSignOptions['expiresIn'];

    const payloadObject: JwtPayload = { ...payload };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payloadObject, {
        secret: this.configService.get<string>('JWT_SECRET') || undefined,
        expiresIn: accessExpiresIn,
        issuer: this.getIssuer(),
        audience: this.getAudience(),
      }),
      this.jwtService.signAsync(payloadObject, {
        secret:
          this.configService.get<string>('REFRESH_TOKEN_SECRET') || undefined,
        expiresIn: refreshExpiresIn,
        issuer: this.getIssuer(),
        audience: this.getAudience(),
      }),
    ]);

    // persist refresh token for rotation/revocation
    const expiresAt = this.computeExpiryDate(refreshExpiresIn);
    const tokenHash = this.hashToken(refreshToken);
    await this.refreshTokenModel.create({
      userId: new Types.ObjectId(user._id),
      jti,
      tokenHash,
      expiresAt,
      revoked: false,
      ip: options.ip,
      userAgent: options.userAgent,
    });

    return {
      accessToken,
      refreshToken,
    };
  }

  private async revokeAllRefreshTokensForUser(userId: string) {
    await this.refreshTokenModel.updateMany(
      { userId: new Types.ObjectId(userId), revoked: false },
      { $set: { revoked: true, revokedAt: new Date() } },
    );
  }

  private hashToken(token: string) {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  private computeExpiryDate(expiresIn: JwtSignOptions['expiresIn']) {
    if (typeof expiresIn === 'number') {
      return new Date(Date.now() + expiresIn * 1000);
    }
    // handle strings like "15m", "7d"
    const match = /^(\d+)([smhd])$/.exec(expiresIn as string);
    if (!match) {
      // fallback: 7 days
      return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    }
    const value = parseInt(match[1], 10);
    const unit = match[2];
    const multipliers: Record<string, number> = {
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
    };
    return new Date(Date.now() + value * multipliers[unit]);
  }

  private sanitizeUser(user: UserDocument) {
    const raw: any =
      user && typeof (user as any).toObject === 'function'
        ? (user as any).toObject()
        : { ...(user as any) };

    // Drop passwordHash/nonce/__v from responses
    const { passwordHash, nonce, __v, ...sanitized } = raw;
    const primaryWallet = raw.primaryWallet;
    const roles = Array.isArray(raw.roles) ? raw.roles : [];
    void passwordHash;
    void nonce;
    void __v;
    const id = raw._id != null ? String(raw._id) : undefined;
    return {
      ...sanitized,
      roles,
      walletAddress: primaryWallet,
      id,
    };
  }

  private requiresMfa(user: UserDocument) {
    return Boolean(user.mfa?.enabled);
  }

  private getAdminAllowedIps(): Set<string> | null {
    const raw = this.configService.get<string>('ADMIN_ALLOWED_IPS');
    if (!raw) return null;
    const set = new Set(
      raw
        .split(',')
        .map((v) => v.trim())
        .filter((v) => v.length > 0),
    );
    return set.size ? set : null;
  }

  private verifyTotp(secret: string, token: string) {
    return speakeasy.totp.verify({
      secret,
      encoding: 'base32',
      token,
      window: 1,
    });
  }

  async triggerEmailVerification(user: UserDocument) {
    if (!user.email || user.emailVerifiedAt) return;
    const currentSends =
      Number(
        (user as { emailVerificationSendCount?: number })
          .emailVerificationSendCount ?? 0,
      ) + 1;
    await this.issueVerificationCode(user, {
      sendCount: currentSends,
      incrementSendCount: true,
      resetAttempts: true,
    });
  }

  private async createPasswordResetToken(user: UserDocument) {
    const expiresIn = (this.configService.get<string>(
      'PASSWORD_RESET_EXPIRY',
    ) || '15m') as JwtSignOptions['expiresIn'];
    const issuer = this.getIssuer();
    const audience = this.getAudience();
    return this.jwtService.signAsync(
      { sub: String(user._id) },
      {
        secret:
          this.configService.get<string>('PASSWORD_RESET_SECRET') ||
          this.configService.get<string>('JWT_SECRET'),
        expiresIn,
        issuer,
        audience,
      },
    );
  }

  private async sendVerificationEmail(email: string | undefined, code: string) {
    if (!email) return;
    const nodeEnv =
      this.configService.get<string>('NODE_ENV') || process.env.NODE_ENV;
    const apiKey = this.configService.get<string>('SENDGRID_API_KEY');
    const from = this.configService.get<string>('EMAIL_FROM');
    const verifyUrl = this.configService.get<string>('FRONTEND_VERIFY_URL');
    const isTestEnv = nodeEnv === 'test';

    if (!apiKey || !from) {
      if (!isTestEnv) {
        this.logger.warn(
          'Skipping verification email: SENDGRID_API_KEY or EMAIL_FROM missing',
        );
        return;
      }
    } else {
      sgMail.setApiKey(apiKey);
      const residency = this.configService.get<string>('SENDGRID_RESIDENCY');
      if (residency) {
        const sgWithResidency = sgMail as unknown as {
          setDataResidency?: (region: string) => void;
        };
        if (typeof sgWithResidency.setDataResidency === 'function') {
          sgWithResidency.setDataResidency(residency);
        }
      }
    }
    const verificationLink = verifyUrl
      ? `${verifyUrl}?code=${encodeURIComponent(code)}&email=${encodeURIComponent(email)}`
      : undefined;
    const text = verificationLink
      ? `Welcome to Truden.\n\nPlease verify your email by opening this link: ${verificationLink}\nIf you did not request this, you can ignore this email.`
      : `Welcome to Truden.\n\nYour verification code: ${code}\nSubmit it to /auth/verify-email along with your email to activate your account.`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; background: #f7f9fb; border: 1px solid #e5e8ec; border-radius: 12px;">
        <div style="text-align: center; margin-bottom: 16px;">
          <div style="font-size: 20px; font-weight: 700; color: #0f1f38;">Truden</div>
          <div style="font-size: 13px; color: #607087;">Crowdfunding Platform</div>
        </div>
        <div style="background: #ffffff; padding: 20px; border-radius: 10px; border: 1px solid #eef1f5;">
          <h2 style="margin: 0 0 12px; color: #0f1f38;">Verify your email</h2>
          <p style="margin: 0 0 12px; color: #304054; line-height: 1.6;">
            Thanks for signing up. Please confirm your email to secure your account and continue.
          </p>
          ${
            verificationLink
              ? `<div style="text-align:center; margin: 20px 0;">
                  <a href="${verificationLink}" style="background: #1f6feb; color: #ffffff; text-decoration: none; padding: 12px 20px; border-radius: 8px; font-weight: 600; display: inline-block;">Verify Email</a>
                </div>
                <p style="margin: 0 0 12px; color: #607087; font-size: 13px; line-height: 1.6;">If the button doesn’t work, copy and paste this link into your browser:<br><span style="word-break: break-all; color: #1f6feb;">${verificationLink}</span></p>`
              : `<p style="margin: 0 0 12px; color: #304054; line-height: 1.6;">Your verification code:</p>
                <div style="padding: 12px; background: #f0f4ff; border-radius: 8px; font-family: monospace; font-size: 16px; font-weight: 700; letter-spacing: 2px; color: #0f1f38; text-align:center;">${code}</div>`
          }
          <p style="margin: 16px 0 0; color: #8a97ab; font-size: 12px;">If you did not request this, you can safely ignore this email.</p>
        </div>
      </div>
    `;
    try {
      const fromAddress = from || 'test@example.com';
      this.logger.log(`Sending verification email to ${email}`);
      await sgMail.send({
        to: email,
        from: fromAddress,
        subject: 'Verify your email',
        text,
        html,
      });
      this.logger.debug(`Sent verification email to ${email}`);
    } catch (err: unknown) {
      this.logger.warn(
        `Failed to send verification email to ${email}: ${this.formatSendgridError(err)}`,
      );
    }
  }

  private async sendPasswordResetEmail(
    email: string | undefined,
    token: string,
  ) {
    if (!email) return;
    const apiKey = this.configService.get<string>('SENDGRID_API_KEY');
    const from = this.configService.get<string>('EMAIL_FROM');
    const resetUrl = this.configService.get<string>('FRONTEND_RESET_URL');
    if (!apiKey || !from) {
      this.logger.warn(
        'Skipping password reset email: SENDGRID_API_KEY or EMAIL_FROM missing',
      );
      return;
    }
    sgMail.setApiKey(apiKey);
    const residency = this.configService.get<string>('SENDGRID_RESIDENCY');
    if (residency) {
      const sgWithResidency = sgMail as unknown as {
        setDataResidency?: (region: string) => void;
      };
      if (typeof sgWithResidency.setDataResidency === 'function') {
        sgWithResidency.setDataResidency(residency);
      }
    }
    const resetLink = resetUrl
      ? `${resetUrl}?token=${encodeURIComponent(token)}`
      : undefined;
    const text = resetLink
      ? `Reset your password: ${resetLink}\nIf you did not request this, ignore this email.`
      : `Reset token: ${token}\nSubmit it to /auth/reset-password with your new password.`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; background: #f7f9fb; border: 1px solid #e5e8ec; border-radius: 12px;">
        <div style="text-align: center; margin-bottom: 16px;">
          <div style="font-size: 20px; font-weight: 700; color: #0f1f38;">Truden</div>
          <div style="font-size: 13px; color: #607087;">Crowdfunding Platform</div>
        </div>
        <div style="background: #ffffff; padding: 20px; border-radius: 10px; border: 1px solid #eef1f5;">
          <h2 style="margin: 0 0 12px; color: #0f1f38;">Reset your password</h2>
          <p style="margin: 0 0 12px; color: #304054; line-height: 1.6;">
            We received a request to reset your password. If this was you, use the link or token below.
          </p>
          ${
            resetLink
              ? `<div style="text-align:center; margin: 20px 0;">
                  <a href="${resetLink}" style="background: #1f6feb; color: #ffffff; text-decoration: none; padding: 12px 20px; border-radius: 8px; font-weight: 600; display: inline-block;">Reset Password</a>
                </div>
                <p style="margin: 0 0 12px; color: #607087; font-size: 13px; line-height: 1.6;">If the button doesn’t work, copy and paste this link into your browser:<br><span style="word-break: break-all; color: #1f6feb;">${resetLink}</span></p>`
              : `<p style="margin: 0 0 12px; color: #304054; line-height: 1.6;">Your reset token:</p>
                <div style="padding: 12px; background: #f0f4ff; border-radius: 8px; font-family: monospace; font-size: 14px; color: #0f1f38;">${token}</div>`
          }
          <p style="margin: 16px 0 0; color: #8a97ab; font-size: 12px;">If you did not request this, you can safely ignore this email.</p>
        </div>
      </div>
    `;
    try {
      this.logger.log(`Sending password reset email to ${email}`);
      await sgMail.send({
        to: email,
        from,
        subject: 'Reset your password',
        text,
        html,
      });
      this.logger.debug(`Sent password reset email to ${email}`);
    } catch (err: unknown) {
      this.logger.warn(
        `Failed to send password reset email to ${email}: ${this.formatSendgridError(err)}`,
      );
    }
  }

  private async verifyGoogleIdToken(
    idToken: string,
  ): Promise<Record<string, unknown>> {
    const clientId = this.configService.get<string>('GOOGLE_CLIENT_ID');
    if (!clientId) {
      this.logger.error(
        'GOOGLE_CLIENT_ID is not configured; rejecting Google OAuth login',
      );
      throw new UnauthorizedException('Google login is not configured');
    }
    try {
      const googleLib = (await import('google-auth-library')) as unknown as {
        OAuth2Client: new (id: string) => {
          verifyIdToken: (opts: {
            idToken: string;
            audience: string;
          }) => Promise<{ getPayload(): Record<string, unknown> | null }>;
        };
      };
      const client = new googleLib.OAuth2Client(clientId);
      const ticket = await client.verifyIdToken({
        idToken,
        audience: clientId,
      });
      const payload = ticket.getPayload();
      if (!payload) {
        throw new Error('Missing payload in Google token');
      }
      return payload;
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : typeof err === 'string'
            ? err
            : 'unknown error';
      this.logger.warn(`Google token verification failed: ${msg}`);
      throw new UnauthorizedException('Invalid Google id token');
    }
  }

  private async verifyAppleIdToken(idToken: string): Promise<JWTPayload> {
    const clientId = this.configService.get<string>('APPLE_CLIENT_ID');
    if (!clientId) {
      this.logger.error(
        'APPLE_CLIENT_ID is not configured; rejecting Apple OAuth login',
      );
      throw new UnauthorizedException('Apple login is not configured');
    }
    try {
      const { payload } = await jwtVerify(idToken, this.appleJwks, {
        issuer: 'https://appleid.apple.com',
        audience: clientId,
      });
      return payload;
    } catch (err: unknown) {
      this.logger.warn(
        `Apple token verification failed: ${this.formatJoseError(err)}`,
      );
      throw new UnauthorizedException('Invalid Apple id token');
    }
  }

  private assertSendWithinWindow(
    user: UserDocument,
    countField: 'emailVerificationSendCount' | 'passwordResetSendCount',
    resetField:
      | 'emailVerificationRateLimitResetAt'
      | 'passwordResetRateLimitResetAt',
    limit: number,
    windowMs: number,
  ) {
    const now = Date.now();
    const resetAtRaw = (user as unknown as Record<string, unknown>)[
      resetField
    ] as Date | undefined;
    let resetAt = resetAtRaw ? resetAtRaw.getTime() : 0;
    const currentCount = (user as unknown as Record<string, unknown>)[
      countField
    ] as number | undefined;
    let count = currentCount ?? 0;
    if (!resetAt || resetAt < now) {
      count = 0;
      resetAt = now + windowMs;
    }
    if (count >= limit) {
      throw new HttpException(
        'Please wait before requesting another email.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return { count, nextReset: resetAt };
  }

  private enforceRateLimit(
    action: string,
    key: string,
    limit: number,
    windowMs: number,
  ) {
    const now = Date.now();
    const mapKey = `${action}:${key}`;
    const current = this.rateLimits.get(mapKey);
    if (current && current.resetAt > now && current.count >= limit) {
      throw new HttpException(
        'Rate limit exceeded, try again later',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (!current || current.resetAt <= now) {
      this.rateLimits.set(mapKey, { count: 1, resetAt: now + windowMs });
    } else {
      this.rateLimits.set(mapKey, {
        count: current.count + 1,
        resetAt: current.resetAt,
      });
    }
  }

  private enforceRateLimitForIp(
    action: string,
    ip: string | undefined,
    limit: number,
    windowMs: number,
  ) {
    if (!ip) return;
    this.enforceRateLimit(action, ip, limit, windowMs);
  }

  private getIssuer(): string | undefined {
    const issuer = this.configService.get<string>('JWT_ISSUER');
    if (issuer && issuer.trim().length > 0) return issuer.trim();
    return undefined;
  }

  private getAudience(): string | undefined {
    const audience = this.configService.get<string>('JWT_AUDIENCE');
    if (audience && audience.trim().length > 0) return audience.trim();
    return undefined;
  }

  private generateEmailVerificationCode() {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const ttlMs = 15 * 60 * 1000; // 15 minutes
    return {
      code,
      expiresAt: new Date(Date.now() + ttlMs),
      hash: this.hashCode(code),
    };
  }

  private hashCode(code: string) {
    return crypto.createHash('sha256').update(code).digest('hex');
  }

  private async issueVerificationCode(
    user: UserDocument,
    opts: {
      sendCount?: number;
      rateLimitReset?: number;
      resetAttempts?: boolean;
      incrementSendCount?: boolean;
    } = {},
  ) {
    const { code, expiresAt, hash } = this.generateEmailVerificationCode();
    await this.sendVerificationEmail(user.email, code);
    const update: Record<string, unknown> = {
      emailVerificationSentAt: new Date(),
      emailVerificationCodeHash: hash,
      emailVerificationCodeExpiresAt: expiresAt,
    };
    if (opts.resetAttempts) {
      update.emailVerificationAttempts = 0;
      update.emailVerificationBlockedUntil = undefined;
    }
    if (typeof opts.sendCount === 'number') {
      update.emailVerificationSendCount = opts.sendCount;
    } else if (opts.incrementSendCount) {
      const sends =
        Number(
          (user as { emailVerificationSendCount?: number })
            .emailVerificationSendCount ?? 0,
        ) + 1;
      update.emailVerificationSendCount = sends;
    }
    if (typeof opts.rateLimitReset === 'number') {
      update.emailVerificationRateLimitResetAt = new Date(opts.rateLimitReset);
    }
    await this.userModel.findByIdAndUpdate(user._id, update).exec();
    return code;
  }

  private formatSendgridError(err: unknown): string {
    if (!err) return 'unknown error';
    if (typeof err === 'string') return err;
    if (err instanceof Error) {
      const anyErr = err as {
        code?: unknown;
        statusCode?: unknown;
        response?: { body?: unknown };
        message: string;
      };
      const status =
        (anyErr.code as string | number | undefined) ??
        (anyErr.statusCode as string | number | undefined);
      const body = anyErr.response?.body;
      if (body) {
        const errors = (body as { errors?: unknown }).errors
          ? JSON.stringify((body as { errors?: unknown }).errors)
          : JSON.stringify(body);
        return `${err.message} (status ${status ?? 'n/a'}, body: ${errors})`;
      }
      return status ? `${err.message} (status ${status})` : err.message;
    }
    try {
      return JSON.stringify(err);
    } catch {
      return 'unknown error';
    }
  }

  private formatJoseError(err: unknown) {
    if (err instanceof Error) return err.message;
    if (typeof err === 'string') return err;
    return 'unknown error';
  }

  private lookupCountryFromIp(ipAddress?: string): string | undefined {
    if (!ipAddress) return undefined;
    try {
      const geo = geoip.lookup(ipAddress);
      if (geo?.country && typeof geo.country === 'string') {
        return geo.country;
      }
    } catch (err: unknown) {
      this.logger.debug(
        `GeoIP lookup failed for ${ipAddress}: ${this.formatJoseError(err)}`,
      );
    }
    return undefined;
  }
}
