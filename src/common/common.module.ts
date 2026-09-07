import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppEmailService } from './services/app-email.service';
import { CsrfGuard } from './guards/csrf.guard';
import { PlatformSignerService } from './services/platform-signer.service';
import { RateLimitService } from './services/rate-limit.service';
import { RateLimitGuard } from './guards/rate-limit.guard';
import { HealthController } from './controllers/health.controller';

@Global()
@Module({
  imports: [ConfigModule],
  controllers: [HealthController],
  providers: [
    AppEmailService,
    CsrfGuard,
    PlatformSignerService,
    RateLimitService,
    RateLimitGuard,
  ],
  exports: [
    AppEmailService,
    CsrfGuard,
    PlatformSignerService,
    RateLimitService,
    RateLimitGuard,
  ],
})
export class CommonModule {}
