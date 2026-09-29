import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { FinancialDatabase } from './financial.database';
import type { PoolClient } from 'pg';
import { FinancialPayoutWorker } from './financial-payout.worker';

export type FinancialJobType = 'payout.dispatch.requested' | 'payout.reconcile.requested' | 'receipt.authorize.requested' | 'receipt.issue.requested' | 'receipt.finalize.requested' | 'receipt.revoke.requested' | 'receipt.reconcile.requested';
type JobRow = { id: string; job_type: FinancialJobType; aggregate_id: string; payload: Record<string, unknown>; attempts: number; max_attempts: number };
const BACKOFF_SECONDS = [5, 30, 120, 600, 3600, 21600];

@Injectable()
export class FinancialJobsService {
  private readonly logger = new Logger(FinancialJobsService.name);
  readonly workerId = `financial-worker:${randomUUID()}`;
  constructor(private readonly database: FinancialDatabase, private readonly payouts?: FinancialPayoutWorker) {}
  async enqueue(client: PoolClient, job: { type: FinancialJobType; aggregateType: string; aggregateId: string; deduplicationKey: string; payload: Record<string, unknown> }) {
    await client.query(`INSERT INTO financial_jobs (job_type,aggregate_type,aggregate_id,deduplication_key,payload) VALUES ($1,$2,$3,$4,$5::jsonb) ON CONFLICT (deduplication_key) DO NOTHING`, [job.type,job.aggregateType,job.aggregateId,job.deduplicationKey,JSON.stringify(job.payload)]);
  }
  async recoverExpiredClaims(): Promise<number> {
    const result = await this.database.query(`UPDATE financial_jobs SET status='retry', claimed_at=NULL, claimed_by=NULL, available_at=now(), last_error_code='claim_lease_expired', last_error_message_safe='Recovered expired worker claim', updated_at=now() WHERE status='processing' AND claimed_at < now() - interval '5 minutes'`);
    return result.rowCount ?? 0;
  }
  async processOne(): Promise<{ processed: boolean; deadLettered?: boolean }> {
    const job = await this.database.transaction(async (client) => {
      const selected = await client.query<JobRow>(`SELECT id,job_type,aggregate_id,payload,attempts,max_attempts FROM financial_jobs WHERE status IN ('pending','retry') AND available_at <= now() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`);
      if (!selected.rowCount) return undefined;
      const row = selected.rows[0];
      await client.query(`UPDATE financial_jobs SET status='processing',attempts=attempts+1,claimed_at=now(),claimed_by=$2,updated_at=now() WHERE id=$1`, [row.id,this.workerId]);
      return { ...row, attempts: row.attempts + 1 };
    });
    if (!job) return { processed: false };
    try {
      await this.handle(job);
      await this.database.query(`UPDATE financial_jobs SET status='succeeded',completed_at=now(),claimed_at=NULL,claimed_by=NULL,updated_at=now() WHERE id=$1 AND status='processing' AND claimed_by=$2`, [job.id,this.workerId]);
      return { processed: true };
    } catch (error) {
      const dead = job.attempts >= job.max_attempts || !this.retryable(error);
      const delay = BACKOFF_SECONDS[Math.min(job.attempts - 1, BACKOFF_SECONDS.length - 1)];
      await this.database.query(`UPDATE financial_jobs SET status=$2,claimed_at=NULL,claimed_by=NULL,available_at=now()+($3 * interval '1 second'),last_error_code=$4,last_error_message_safe=$5,dead_lettered_at=CASE WHEN $2='dead_letter' THEN now() ELSE NULL END,updated_at=now() WHERE id=$1 AND status='processing' AND claimed_by=$6`, [job.id,dead ? 'dead_letter' : 'retry',delay,this.errorCode(error),this.safeMessage(error),this.workerId]);
      this.logger.warn(`Financial job ${job.id} ${dead ? 'dead-lettered' : 'scheduled for retry'}`);
      return { processed: false, deadLettered: dead };
    }
  }
  private async handle(job: JobRow): Promise<void> {
    if (job.job_type === 'payout.dispatch.requested' && this.payouts) return this.payouts.dispatch(job.payload);
    if (job.job_type === 'payout.reconcile.requested' && this.payouts) return this.payouts.reconcile(job.payload);
    throw Object.assign(new Error(`No durable handler registered for ${job.job_type}`), { code: 'JOB_HANDLER_UNAVAILABLE' });
  }
  private retryable(error: unknown) { const code = this.errorCode(error); return ['ETIMEDOUT','ECONNRESET','ECONNREFUSED','EAI_AGAIN','RPC_PENDING'].includes(code); }
  private errorCode(error: unknown) { return typeof (error as { code?: unknown })?.code === 'string' ? String((error as { code: string }).code) : 'JOB_HANDLER_ERROR'; }
  private safeMessage(error: unknown) { return (error instanceof Error ? error.message : 'Financial job failed').slice(0,500); }
}
