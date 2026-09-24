import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppEmailService } from './services/app-email.service';
import { CsrfGuard } from './guards/csrf.guard';
import { PlatformSignerService } from './services/platform-signer.service';
import { RateLimitService } from './services/rate-limit.service';
import { RateLimitGuard } from './guards/rate-limit.guard';
import { HealthController } from './controllers/health.controller';
import { KeiboContractConfigService } from './services/keibo-contract-config.service';
import { KeiboGovernanceService } from './services/keibo-governance.service';
import { KeiboDealRoomEvidenceService } from './services/keibo-deal-room-evidence.service';
import { EscrowWeb3Service } from '../modules/escrow/escrow.web3';

@Global()
@Module({
  imports: [ConfigModule],
  controllers: [HealthController],
  providers: [
    AppEmailService,
    CsrfGuard,
    PlatformSignerService,
    KeiboContractConfigService,
    KeiboGovernanceService,
    KeiboDealRoomEvidenceService,
    EscrowWeb3Service,
    RateLimitService,
    RateLimitGuard,
  ],
  exports: [
    AppEmailService,
    CsrfGuard,
    PlatformSignerService,
    KeiboContractConfigService,
    KeiboGovernanceService,
    KeiboDealRoomEvidenceService,
    EscrowWeb3Service,
    RateLimitService,
    RateLimitGuard,
  ],
})
export class CommonModule {}
