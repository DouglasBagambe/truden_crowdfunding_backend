import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FinancialService } from './financial.service';
import { FinancialOutboxService } from './financial-outbox.service';
import { FinancialProjectionWorker } from './projections/financial-projection.worker';
import { FinancialJobsService } from './financial-jobs.service';

@Injectable()
export class FinancialWorkersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FinancialWorkersService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly financial: FinancialService,
    private readonly outbox: FinancialOutboxService,
    private readonly projections: FinancialProjectionWorker,
    private readonly jobs: FinancialJobsService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (this.config.get<string>('FINANCIAL_WORKERS_ENABLED') !== 'true') return;
    await this.financial.initializeSchema();
    await this.outbox.recoverStaleProcessing();
    await this.jobs.recoverExpiredClaims();
    this.timer = setInterval(() => void this.tick(), 1_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.financial.processNextInboxEvent();
      await this.outbox.publishNext();
      await this.projections.processOne();
      await this.jobs.processOne();
    } catch (error: unknown) {
      this.logger.error(
        error instanceof Error
          ? `Financial worker tick failed: ${error.message}`
          : 'Financial worker tick failed',
      );
    } finally {
      this.running = false;
    }
  }
}
