import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  Req,
  Res,
} from '@nestjs/common';
import type { Request as ExpressRequest, Response } from 'express';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OAuthLoginDto } from './dto/oauth-login.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { AuthProvider } from './dto/oauth-login.dto';
import { ResendEmailDto } from './dto/resend-email.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { EnableMfaDto } from './dto/enable-mfa.dto';
import { DisableMfaDto } from './dto/disable-mfa.dto';
import { VerifyEmailMfaDto } from './dto/email-mfa.dto';
import { SiweNonceDto } from './dto/siwe.dto';
import { AuthCookieService } from './auth-cookie.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly authCookieService: AuthCookieService,
  ) {}

  @Public()
  @Get('csrf')
  issueCsrf(@Res({ passthrough: true }) response: Response) {
    return { csrfToken: this.authCookieService.setCsrf(response) };
  }

  @Public()
  @Post('register')
  async register(
    @Body() registerDto: RegisterDto,
    @Req() req: ExpressRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.register(
      registerDto,
      this.getClientIp(req),
    );
    return this.establishSession(response, result);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() loginDto: LoginDto,
    @Req() req: ExpressRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.login(
      loginDto,
      this.getClientIp(req),
    );
    return this.establishSession(response, result);
  }

  @Public()
  @Post('login/oauth')
  @HttpCode(HttpStatus.OK)
  async oauthLogin(
    @Body() dto: OAuthLoginDto,
    @Req() req: ExpressRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.oauthLogin(
      dto,
      this.getClientIp(req),
    );
    return this.establishSession(response, result);
  }

  // Aliases to keep original naming familiar while supporting Google/Apple directly
  @Public()
  @Post('login/google')
  @HttpCode(HttpStatus.OK)
  async loginGoogle(
    @Body('idToken') idToken: string,
    @Req() req: ExpressRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.oauthLogin(
      { provider: AuthProvider.GOOGLE, idToken },
      this.getClientIp(req),
    );
    return this.establishSession(response, result);
  }

  @Public()
  @Post('login/apple')
  @HttpCode(HttpStatus.OK)
  async loginApple(
    @Body('idToken') idToken: string,
    @Req() req: ExpressRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.oauthLogin(
      { provider: AuthProvider.APPLE, idToken },
      this.getClientIp(req),
    );
    return this.establishSession(response, result);
  }

  @Public()
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.authService.verifyEmail(dto);
  }

  @Public()
  @Post('resend-email')
  @HttpCode(HttpStatus.OK)
  async resendEmail(@Body() dto: ResendEmailDto, @Req() req: ExpressRequest) {
    return this.authService.resendVerificationEmail(
      dto.email,
      this.getClientIp(req),
    );
  }

  @UseGuards(JwtAuthGuard)
  @Post('resend-email/current')
  @HttpCode(HttpStatus.OK)
  async resendCurrentEmail(
    @CurrentUser('sub') userId: string,
    @Req() req: ExpressRequest,
  ) {
    return this.authService.resendVerificationEmailForUser(
      userId,
      this.getClientIp(req),
    );
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(
    @Body() dto: ForgotPasswordDto,
    @Req() req: ExpressRequest,
  ) {
    return this.authService.forgotPassword(dto.email, this.getClientIp(req));
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.token, dto.newPassword);
  }

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  async getProfile(@CurrentUser('sub') userId: string) {
    return this.authService.getProfile(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('siwe/nonce')
  @HttpCode(HttpStatus.OK)
  async issueSiweNonce(
    @CurrentUser('sub') userId: string,
    @Body() dto: SiweNonceDto,
  ) {
    return this.authService.issueSiweNonce(userId, dto.address, dto.purpose);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refreshToken(
    @Req() request: ExpressRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const refreshToken = request.cookies?.keibo_refresh as string | undefined;
    const result = await this.authService.refreshToken(refreshToken);
    return this.establishSession(response, result);
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @CurrentUser('sub') userId: string,
    @Req() request: ExpressRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.authService.logoutCurrent(
      userId,
      request.cookies?.keibo_refresh as string | undefined,
    );
    this.authCookieService.clearSession(response);
    return { message: 'Logged out successfully' };
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout-all')
  @HttpCode(HttpStatus.OK)
  async logoutAll(
    @CurrentUser('sub') userId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.authService.logoutAll(userId);
    this.authCookieService.clearSession(response);
    return { message: 'Logged out on all devices' };
  }

  @UseGuards(JwtAuthGuard)
  @Post('mfa/setup')
  @HttpCode(HttpStatus.OK)
  startMfa(@CurrentUser('sub') userId: string) {
    return this.authService.startMfaSetup(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('mfa/enable')
  @HttpCode(HttpStatus.OK)
  enableMfa(@CurrentUser('sub') userId: string, @Body() dto: EnableMfaDto) {
    return this.authService.enableMfa(userId, dto.token);
  }

  @UseGuards(JwtAuthGuard)
  @Post('mfa/email/start')
  @HttpCode(HttpStatus.OK)
  startEmailMfa(@CurrentUser('sub') userId: string) {
    return this.authService.startEmailMfaSetup(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('mfa/email/enable')
  @HttpCode(HttpStatus.OK)
  enableEmailMfa(
    @CurrentUser('sub') userId: string,
    @Body() dto: VerifyEmailMfaDto,
  ) {
    return this.authService.enableEmailMfa(userId, dto.token);
  }

  @UseGuards(JwtAuthGuard)
  @Post('mfa/disable')
  @HttpCode(HttpStatus.OK)
  disableMfa(@CurrentUser('sub') userId: string, @Body() dto: DisableMfaDto) {
    return this.authService.disableMfa(userId, dto.token);
  }

  private getClientIp(req: ExpressRequest): string | undefined {
    return this.normalizeIp(
      req.ip ||
        (req.socket?.remoteAddress ??
          (req.connection as { remoteAddress?: string })?.remoteAddress),
    );
  }

  private normalizeIp(ip?: string): string | undefined {
    if (!ip) return undefined;
    // Handle IPv6 localhost and IPv4-mapped IPv6 addresses
    if (ip === '::1') return '127.0.0.1';
    if (ip.startsWith('::ffff:')) return ip.replace('::ffff:', '');
    // Strip IPv6 zone index if present
    const zoneIndex = ip.indexOf('%');
    if (zoneIndex !== -1) return ip.slice(0, zoneIndex);
    return ip;
  }

  private establishSession<
    T extends { accessToken: string; refreshToken: string },
  >(response: Response, result: T): Omit<T, 'accessToken' | 'refreshToken'> {
    this.authCookieService.setSession(response, result);
    const {
      accessToken: _accessToken,
      refreshToken: _refreshToken,
      ...safe
    } = result;
    void _accessToken;
    void _refreshToken;
    return safe;
  }
}
