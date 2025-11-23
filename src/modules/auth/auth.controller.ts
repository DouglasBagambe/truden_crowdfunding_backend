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
import { SiweNonceDto, SiweVerifyDto } from './dto/siwe.dto';
import { LinkWalletDto } from './dto/link-wallet.dto';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

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
  @Post('siwe/nonce')
  @HttpCode(HttpStatus.OK)
  async getSiweNonce(@Body() siweNonceDto: SiweNonceDto) {
    const nonce = await this.authService.generateSiweNonce(
      siweNonceDto.address,
    );
    return { nonce };
  }

  @Public()
  @Post('siwe/verify')
  @HttpCode(HttpStatus.OK)
  async verifySiwe(@Body() siweVerifyDto: SiweVerifyDto) {
    return this.authService.verifySiwe(siweVerifyDto);
  }

  @UseGuards(JwtAuthGuard)
  @Post('link-wallet')
  async linkWallet(
    @CurrentUser('sub') userId: string,
    @Body() linkWalletDto: LinkWalletDto,
  ) {
    return this.authService.linkWallet(userId, linkWalletDto);
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
    return {
      message: 'Logged out successfully',
    };
  }
}
