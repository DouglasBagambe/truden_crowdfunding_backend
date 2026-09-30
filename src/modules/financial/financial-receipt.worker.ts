import { Injectable } from '@nestjs/common';
import { FinancialDatabase } from './financial.database';
import { KeiboInvestmentReceiptService } from '../investments/services/keibo-investment-receipt.service';

type ReceiptJobRow = {
  id: string;
  state: string;
  tx_hash: `0x${string}` | null;
  investor_wallet: `0x${string}`;
  campaign_id: string;
  amount_minor: string;
  expires_at: Date;
  policy_hash: `0x${string}`;
  eligibility_signature: `0x${string}`;
  nonce: string;
  eligibility_id: string;
  eligibility_status: string;
  issuance_state: string;
  issuance_id: string;
  reason_hash: `0x${string}`;
};

@Injectable()
export class FinancialReceiptWorker {
  constructor(
    private readonly database: FinancialDatabase,
    private readonly receipt: KeiboInvestmentReceiptService,
  ) {}
  async issue(payload: Record<string, unknown>) {
    const id = typeof payload.issuanceId === 'string' ? payload.issuanceId : '';
    if (!id)
      throw Object.assign(new Error('Invalid receipt issuance job'), {
        code: 'INVALID_PAYLOAD',
      });
    const row = await this.database.query<ReceiptJobRow>(
      `SELECT i.*,e.investor_wallet,e.campaign_id,e.amount_minor,e.expires_at,e.policy_hash,e.eligibility_signature,e.nonce,e.status AS eligibility_status FROM financial_receipt_issuances i JOIN financial_receipt_eligibilities e ON e.id=i.eligibility_id WHERE i.id=$1`,
      [id],
    );
    if (!row.rowCount)
      throw Object.assign(new Error('Receipt issuance not found'), {
        code: 'NOT_FOUND',
      });
    const issuance = row.rows[0];
    if (issuance.state === 'ISSUED' || issuance.tx_hash) return;
    if (
      issuance.eligibility_status !== 'AUTHORIZED' ||
      new Date(issuance.expires_at).getTime() <= Date.now()
    )
      throw Object.assign(
        new Error('Receipt eligibility is invalid or expired'),
        { code: 'RECEIPT_POLICY_INVALID' },
      );
    const hash = await this.receipt.submitIssue({
      investor: issuance.investor_wallet,
      campaignId: String(issuance.campaign_id),
      amount: BigInt(issuance.amount_minor),
      expiresAt: BigInt(
        Math.floor(new Date(issuance.expires_at).getTime() / 1000),
      ),
      policyHash: issuance.policy_hash,
      eligibilitySignature: issuance.eligibility_signature,
      expectedNonce: BigInt(issuance.nonce),
    });
    await this.database.transaction(async (c) => {
      const updated = await c.query(
        `UPDATE financial_receipt_issuances SET tx_hash=$2,state='SUBMITTED',submitted_at=now(),updated_at=now() WHERE id=$1 AND tx_hash IS NULL RETURNING id`,
        [id, hash],
      );
      if (!updated.rowCount) return;
      await c.query(
        `UPDATE financial_receipt_eligibilities SET status='CONSUMED',used_at=now(),updated_at=now() WHERE id=$1`,
        [issuance.eligibility_id],
      );
      await c.query(
        `INSERT INTO financial_outbox(topic,aggregate_id,payload,correlation_id) VALUES('receipt.submitted',$1,$2::jsonb,gen_random_uuid())`,
        [id, JSON.stringify({ issuanceId: id, txHash: hash })],
      );
      await c.query(
        `INSERT INTO financial_jobs(job_type,aggregate_type,aggregate_id,deduplication_key,payload,available_at) VALUES('receipt.finalize.requested','receipt_issuance',$1,$2,$3::jsonb,now()+interval '30 seconds') ON CONFLICT(deduplication_key) DO UPDATE SET available_at=LEAST(financial_jobs.available_at,EXCLUDED.available_at)`,
        [id, `receipt.finalize:${id}`, JSON.stringify({ issuanceId: id })],
      );
    });
  }
  async finalize(payload: Record<string, unknown>) {
    const id = typeof payload.issuanceId === 'string' ? payload.issuanceId : '';
    if (!id)
      throw Object.assign(new Error('Invalid receipt finalization job'), {
        code: 'INVALID_PAYLOAD',
      });
    const row = await this.database.query<ReceiptJobRow>(
      `SELECT i.*,e.investor_wallet,e.campaign_id,e.amount_minor,e.nonce FROM financial_receipt_issuances i JOIN financial_receipt_eligibilities e ON e.id=i.eligibility_id WHERE i.id=$1`,
      [id],
    );
    if (!row.rowCount)
      throw Object.assign(new Error('Receipt issuance not found'), {
        code: 'NOT_FOUND',
      });
    const issuance = row.rows[0];
    if (issuance.state === 'ISSUED') return;
    if (!issuance.tx_hash)
      throw Object.assign(new Error('Receipt transaction is not submitted'), {
        code: 'RPC_PENDING',
      });
    const receipt = await this.receipt.getTransactionReceipt(issuance.tx_hash);
    if (receipt.state === 'PENDING')
      throw Object.assign(new Error('Receipt transaction is pending'), {
        code: 'RPC_PENDING',
      });
    if (receipt.state === 'REVERTED') {
      await this.database.query(
        `UPDATE financial_receipt_issuances SET state='FAILED',failure_code='CHAIN_REVERTED',failure_message_safe='Receipt transaction reverted',updated_at=now() WHERE id=$1 AND state<>'ISSUED'`,
        [id],
      );
      return;
    }
    const evidence = this.receipt.inspectReceiptIssued(receipt);
    if (
      evidence.investor !== String(issuance.investor_wallet).toLowerCase() ||
      evidence.campaignId !== BigInt(issuance.campaign_id) ||
      evidence.amount !== BigInt(issuance.amount_minor)
    )
      throw Object.assign(new Error('Receipt event does not match issuance'), {
        code: 'RECEIPT_EVENT_INVALID',
      });
    await this.database.transaction(async (c) => {
      const updated = await c.query(
        `UPDATE financial_receipt_issuances SET state='ISSUED',block_number=$2,transaction_index=$3,log_index=$4,event_identity=$5,issued_at=now(),updated_at=now() WHERE id=$1 AND state<>'ISSUED' RETURNING id`,
        [
          id,
          evidence.blockNumber.toString(),
          receipt.transactionIndex,
          evidence.logIndex,
          evidence.eventIdentity,
        ],
      );
      if (updated.rowCount)
        await c.query(
          `INSERT INTO financial_outbox(topic,aggregate_id,payload,correlation_id) VALUES('receipt.issued',$1,$2::jsonb,gen_random_uuid())`,
          [
            id,
            JSON.stringify({
              issuanceId: id,
              transactionHash: issuance.tx_hash,
            }),
          ],
        );
    });
  }
  async revoke(payload: Record<string, unknown>) {
    const id =
      typeof payload.revocationId === 'string' ? payload.revocationId : '';
    if (!id)
      throw Object.assign(new Error('Invalid receipt revocation job'), {
        code: 'INVALID_PAYLOAD',
      });
    const row = await this.database.query<ReceiptJobRow>(
      `SELECT r.*,i.state AS issuance_state,i.tx_hash AS issuance_tx_hash,i.chain_id,i.contract_address,e.investor_wallet,e.campaign_id,e.amount_minor
       FROM financial_receipt_revocations r JOIN financial_receipt_issuances i ON i.id=r.issuance_id
       JOIN financial_receipt_eligibilities e ON e.id=i.eligibility_id WHERE r.id=$1`,
      [id],
    );
    if (!row.rowCount)
      throw Object.assign(new Error('Receipt revocation not found'), {
        code: 'NOT_FOUND',
      });
    const revocation = row.rows[0];
    if (
      revocation.state === 'REVOKED' ||
      revocation.issuance_state === 'REVOKED'
    )
      return;
    if (revocation.issuance_state !== 'ISSUED')
      throw Object.assign(new Error('Receipt is not issued'), {
        code: 'RECEIPT_POLICY_INVALID',
      });
    let txHash = revocation.tx_hash;
    if (!txHash) {
      txHash = await this.receipt.submitRevoke({
        investor: revocation.investor_wallet,
        campaignId: String(revocation.campaign_id),
        amount: BigInt(revocation.amount_minor),
        reasonHash: revocation.reason_hash,
      });
      await this.database.transaction(async (client) => {
        const updated = await client.query(
          `UPDATE financial_receipt_revocations SET tx_hash=$2,state='SUBMITTED',updated_at=now() WHERE id=$1 AND tx_hash IS NULL RETURNING id`,
          [id, txHash],
        );
        if (!updated.rowCount) return;
        await client.query(
          `INSERT INTO financial_outbox(topic,aggregate_id,payload,correlation_id) VALUES('receipt.revocation.submitted',$1,$2::jsonb,gen_random_uuid())`,
          [id, JSON.stringify({ revocationId: id, txHash })],
        );
      });
    }
    const receipt = await this.receipt.getTransactionReceipt(txHash);
    if (receipt.state === 'PENDING')
      throw Object.assign(
        new Error('Receipt revocation transaction is pending'),
        {
          code: 'RPC_PENDING',
        },
      );
    if (receipt.state === 'REVERTED') {
      await this.database.transaction(async (client) => {
        await client.query(
          `UPDATE financial_receipt_revocations SET state='FAILED',failure_code='CHAIN_REVERTED',failure_message_safe='Receipt revocation transaction reverted',updated_at=now() WHERE id=$1 AND state NOT IN ('REVOKED','FAILED')`,
          [id],
        );
        await client.query(
          `INSERT INTO financial_outbox(topic,aggregate_id,payload,correlation_id) VALUES('receipt.failed',$1,$2::jsonb,gen_random_uuid())`,
          [id, JSON.stringify({ revocationId: id, code: 'CHAIN_REVERTED' })],
        );
      });
      return;
    }
    const evidence = this.receipt.inspectReceiptRevoked(receipt);
    if (
      evidence.investor !== String(revocation.investor_wallet).toLowerCase() ||
      evidence.campaignId !== BigInt(revocation.campaign_id) ||
      evidence.amount !== BigInt(revocation.amount_minor) ||
      evidence.reasonHash?.toLowerCase() !==
        String(revocation.reason_hash).toLowerCase()
    )
      throw Object.assign(
        new Error('Receipt revocation event does not match receipt'),
        { code: 'RECEIPT_EVENT_INVALID' },
      );
    await this.database.transaction(async (client) => {
      const updated = await client.query(
        `UPDATE financial_receipt_revocations SET state='REVOKED',block_number=$2,log_index=$3,event_identity=$4,revoked_at=now(),updated_at=now() WHERE id=$1 AND state<>'REVOKED' RETURNING id`,
        [
          id,
          evidence.blockNumber.toString(),
          evidence.logIndex,
          evidence.eventIdentity,
        ],
      );
      if (!updated.rowCount) return;
      await client.query(
        `UPDATE financial_receipt_issuances SET state='REVOKED',updated_at=now() WHERE id=$1 AND state='ISSUED'`,
        [revocation.issuance_id],
      );
      await client.query(
        `INSERT INTO financial_outbox(topic,aggregate_id,payload,correlation_id) VALUES('receipt.revoked',$1,$2::jsonb,gen_random_uuid())`,
        [
          revocation.issuance_id,
          JSON.stringify({
            issuanceId: revocation.issuance_id,
            revocationId: id,
            txHash,
          }),
        ],
      );
    });
  }
}
