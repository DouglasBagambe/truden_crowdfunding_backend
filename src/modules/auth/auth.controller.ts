import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
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

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  async register(@Body() registerDto: RegisterDto) {
    return this.authService.register(registerDto);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() loginDto: LoginDto) {
    return this.authService.login(loginDto);
  }

  @Public()
  @Post('login/oauth')
  @HttpCode(HttpStatus.OK)
  async oauthLogin(@Body() dto: OAuthLoginDto) {
    return this.authService.oauthLogin(dto);
  }

  // Aliases to keep original naming familiar while supporting Google/Apple directly
  @Public()
  @Post('login/google')
  @HttpCode(HttpStatus.OK)
  async loginGoogle(@Body('idToken') idToken: string) {
    return this.authService.oauthLogin({ provider: AuthProvider.GOOGLE, idToken });
  }

  @Public()
  @Post('login/apple')
  @HttpCode(HttpStatus.OK)
  async loginApple(@Body('idToken') idToken: string) {
    return this.authService.oauthLogin({ provider: AuthProvider.APPLE, idToken });
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
  async resendEmail(@Body() dto: ResendEmailDto) {
    return this.authService.resendVerificationEmail(dto.email);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.email);
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

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refreshToken(@Body('refreshToken') refreshToken: string) {
    return this.authService.refreshToken(refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  logout() {
    // No stateful logout (JWT); provided for API parity
    return { message: 'Logged out successfully' };
  }
}
