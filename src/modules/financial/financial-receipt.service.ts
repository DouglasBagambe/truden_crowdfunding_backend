import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Address, Hex } from 'viem';
import { KeiboContractConfigService } from '../../common/services/keibo-contract-config.service';
import { PlatformSignerService } from '../../common/services/platform-signer.service';
import { KeiboInvestmentReceiptService } from '../investments/services/keibo-investment-receipt.service';
import { ProjectsService } from '../projects/projects.service';
import { UsersRepository } from '../users/repositories/users.repository';
import { FinancialDatabase } from './financial.database';
import {
  canonicalReceiptPolicy,
  receiptReasonHash,
  RECEIPT_POLICY_VERSION,
} from './receipt-policy.util';

const EXPIRY_SECONDS = 15 * 60;
type Settlement = {
  id: string;
  project_id: string;
  contributor_id: string;
  amount_minor: string;
  state: string;
  investor_wallet: string;
  campaign_id: string;
};

@Injectable()
export class FinancialReceiptService {
  constructor(
    private readonly database: FinancialDatabase,
    private readonly users: UsersRepository,
    private readonly projects: ProjectsService,
    private readonly config: KeiboContractConfigService,
    private readonly signer: PlatformSignerService,
    private readonly receipt: KeiboInvestmentReceiptService,
  ) {}

  async authorize(userId: string, settlementId: string) {
    const runtime = this.config.getRequired();
    const settlement = await this.settlement(userId, settlementId);
    const user = await this.users.findById(userId);
    if (user?.kycStatus !== 'VERIFIED')
      throw new ForbiddenException(
        'Verified KYC is required for receipt eligibility',
      );
    const wallet = settlement.investor_wallet.toLowerCase() as Address;
    const linked = [user?.primaryWallet, ...(user?.linkedWallets ?? [])]
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.toLowerCase());
    if (!linked.includes(wallet))
      throw new ConflictException(
        'Settlement wallet is not verified for this investor',
      );
    await this.projects.assertProjectOnchainId(
      settlement.project_id,
      settlement.campaign_id,
    );
    const existing = await this.database.query<any>(
      'SELECT * FROM financial_receipt_eligibilities WHERE payment_intent_id=$1',
      [settlementId],
    );
    if (
      existing.rowCount &&
      existing.rows[0].status === 'AUTHORIZED' &&
      new Date(existing.rows[0].expires_at).getTime() > Date.now()
    )
      return this.safeEligibility(existing.rows[0]);
    if (
      existing.rowCount &&
      ['CONSUMED', 'AUTHORIZED'].includes(existing.rows[0].status)
    )
      throw new ConflictException(
        'Receipt eligibility already exists for this settlement',
      );
    const nonce = await this.receipt.getInvestorNonce(wallet);
    const expiresAt = BigInt(Math.floor(Date.now() / 1000) + EXPIRY_SECONDS);
    const policy = canonicalReceiptPolicy({
      chainId: runtime.chainId,
      investor: wallet,
      campaignId: BigInt(settlement.campaign_id),
      amount: BigInt(settlement.amount_minor),
      settlementId,
      expiresAt,
    });
    const signature = await this.signer.signReceiptEligibility({
      chainId: runtime.chainId,
      verifyingContract: runtime.receipt,
      investor: wallet,
      campaignId: BigInt(settlement.campaign_id),
      amount: BigInt(settlement.amount_minor),
      expiresAt,
      policyHash: policy.policyHash,
      nonce,
    });
    const row = await this.database.transaction(async (client) => {
      const result = await client.query<any>(
        `INSERT INTO financial_receipt_eligibilities(payment_intent_id,user_id,investor_wallet,campaign_id,amount_minor,chain_id,policy_version,canonical_policy_payload,policy_hash,eligibility_signature,nonce,expires_at,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,to_timestamp($12),'AUTHORIZED') ON CONFLICT(payment_intent_id) DO UPDATE SET canonical_policy_payload=EXCLUDED.canonical_policy_payload,policy_hash=EXCLUDED.policy_hash,eligibility_signature=EXCLUDED.eligibility_signature,nonce=EXCLUDED.nonce,expires_at=EXCLUDED.expires_at,status='AUTHORIZED',updated_at=now() WHERE financial_receipt_eligibilities.status IN ('EXPIRED','FAILED') RETURNING *`,
        [
          settlementId,
          userId,
          wallet,
          settlement.campaign_id,
          settlement.amount_minor,
          runtime.chainId,
          RECEIPT_POLICY_VERSION,
          policy.canonicalPayload,
          policy.policyHash,
          signature,
          nonce.toString(),
          expiresAt.toString(),
        ],
      );
      if (!result.rowCount)
        throw new ConflictException('Receipt eligibility cannot be replaced');
      await this.outbox(
        client,
        'receipt.eligibility.authorized',
        result.rows[0].id,
        { settlementId, eligibilityId: result.rows[0].id },
      );
      return result.rows[0];
    });
    return { ...this.safeEligibility(row), signature };
  }

  async issue(userId: string, settlementId: string) {
    return this.database.transaction(async (client) => {
      const eligibility = await client.query<any>(
        `SELECT * FROM financial_receipt_eligibilities WHERE payment_intent_id=$1 AND user_id=$2 FOR UPDATE`,
        [settlementId, userId],
      );
      if (!eligibility.rowCount || eligibility.rows[0].status !== 'AUTHORIZED')
        throw new ConflictException('No authorized receipt eligibility');
      if (new Date(eligibility.rows[0].expires_at).getTime() <= Date.now()) {
        await client.query(
          "UPDATE financial_receipt_eligibilities SET status='EXPIRED',updated_at=now() WHERE id=$1",
          [eligibility.rows[0].id],
        );
        throw new ConflictException('Receipt eligibility has expired');
      }
      const prior = await client.query<any>(
        'SELECT id,state,tx_hash FROM financial_receipt_issuances WHERE payment_intent_id=$1 FOR UPDATE',
        [settlementId],
      );
      if (prior.rowCount) return { ...prior.rows[0], replayed: true };
      const runtime = this.config.getRequired();
      const id = randomUUID();
      await client.query(
        `INSERT INTO financial_receipt_issuances(id,eligibility_id,payment_intent_id,state,chain_id,contract_address) VALUES($1,$2,$3,'AUTHORIZED',$4,$5)`,
        [
          id,
          eligibility.rows[0].id,
          settlementId,
          runtime.chainId,
          runtime.receipt.toLowerCase(),
        ],
      );
      await client.query(
        `INSERT INTO financial_jobs(job_type,aggregate_type,aggregate_id,deduplication_key,payload) VALUES('receipt.issue.requested','receipt_issuance',$1,$2,$3::jsonb)`,
        [id, `receipt.issue:${id}`, JSON.stringify({ issuanceId: id })],
      );
      await this.outbox(client, 'receipt.issue.requested', id, {
        issuanceId: id,
        settlementId,
      });
      return { id, state: 'AUTHORIZED', replayed: false };
    });
  }

  async get(userId: string, settlementId: string) {
    const row = await this.database.query<any>(
      `SELECT i.id,i.state,i.tx_hash,i.block_number,i.log_index,i.receipt_token_id,i.issued_at,r.state AS revocation_state,e.investor_wallet,e.campaign_id,e.amount_minor FROM financial_receipt_issuances i JOIN financial_receipt_eligibilities e ON e.id=i.eligibility_id LEFT JOIN financial_receipt_revocations r ON r.issuance_id=i.id WHERE i.payment_intent_id=$1 AND e.user_id=$2`,
      [settlementId, userId],
    );
    if (!row.rowCount) throw new NotFoundException('Receipt not found');
    return row.rows[0];
  }

  async requestRevocation(
    requestedBy: string,
    issuanceId: string,
    reason: string,
  ) {
    if (!reason.trim())
      throw new ConflictException('A revocation reason is required');
    return this.database.transaction(async (client) => {
      const issuance = await client.query<any>(
        'SELECT id,state FROM financial_receipt_issuances WHERE id=$1 FOR UPDATE',
        [issuanceId],
      );
      if (!issuance.rowCount || issuance.rows[0].state !== 'ISSUED')
        throw new ConflictException('Only issued receipts can be revoked');
      const prior = await client.query<any>(
        'SELECT id,state FROM financial_receipt_revocations WHERE issuance_id=$1 FOR UPDATE',
        [issuanceId],
      );
      if (prior.rowCount) return { ...prior.rows[0], replayed: true };
      const id = randomUUID();
      await client.query(
        `INSERT INTO financial_receipt_revocations(id,issuance_id,requested_by,reason_hash,state) VALUES($1,$2,$3,$4,'PENDING')`,
        [id, issuanceId, requestedBy, receiptReasonHash(reason)],
      );
      await client.query(
        `INSERT INTO financial_jobs(job_type,aggregate_type,aggregate_id,deduplication_key,payload) VALUES('receipt.revoke.requested','receipt_revocation',$1,$2,$3::jsonb)`,
        [id, `receipt.revoke:${id}`, JSON.stringify({ revocationId: id })],
      );
      await this.outbox(client, 'receipt.revocation.requested', id, {
        revocationId: id,
        issuanceId,
      });
      return { id, state: 'PENDING', replayed: false };
    });
  }

  private async settlement(userId: string, id: string): Promise<Settlement> {
    const row = await this.database.query<any>(
      `SELECT p.id,p.project_id,p.contributor_id,p.amount_minor,p.state,split_part(e.event_identity,':',4) AS investor_wallet,split_part(e.event_identity,':',3) AS campaign_id FROM financial_payment_intents p JOIN financial_chain_evidence e ON e.payment_intent_id=p.id WHERE p.id=$1 AND p.contributor_id=$2 AND p.state='settled'`,
      [id, userId],
    );
    if (!row.rowCount)
      throw new NotFoundException('Qualifying settled contribution not found');
    const result = row.rows[0];
    if (
      !/^0x[0-9a-fA-F]{40}$/.test(result.investor_wallet) ||
      !/^\d+$/.test(result.campaign_id)
    )
      throw new ConflictException('Settlement chain evidence is invalid');
    return result;
  }
  private safeEligibility(row: any) {
    return {
      id: row.id,
      settlementId: row.payment_intent_id,
      investorWallet: row.investor_wallet,
      campaignId: row.campaign_id,
      amount: row.amount_minor,
      chainId: row.chain_id,
      policyHash: row.policy_hash,
      nonce: row.nonce,
      expiresAt: row.expires_at,
      status: row.status,
    };
  }
  private async outbox(
    client: any,
    topic: string,
    aggregateId: string,
    payload: Record<string, unknown>,
  ) {
    await client.query(
      `INSERT INTO financial_outbox(topic,aggregate_id,payload,correlation_id) VALUES($1,$2,$3::jsonb,$4)`,
      [topic, aggregateId, JSON.stringify(payload), randomUUID()],
    );
  }
}
