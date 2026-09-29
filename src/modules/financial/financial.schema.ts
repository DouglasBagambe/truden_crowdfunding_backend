export const FINANCIAL_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS financial_payment_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id text NOT NULL,
  contributor_id text NOT NULL, amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  currency char(3) NOT NULL, state text NOT NULL CHECK (state IN ('pending','authorized','captured','settled','released','refunded','failed','reversed','adjusted')),
  idempotency_key text NOT NULL UNIQUE, correlation_id uuid NOT NULL,
  provider text, provider_fee_minor bigint CHECK (provider_fee_minor >= 0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS financial_journals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), idempotency_key text NOT NULL UNIQUE,
  correlation_id uuid NOT NULL, description text NOT NULL, reversal_of uuid REFERENCES financial_journals(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE financial_payment_intents ADD COLUMN IF NOT EXISTS provider text;
ALTER TABLE financial_payment_intents ADD COLUMN IF NOT EXISTS provider_fee_minor bigint CHECK (provider_fee_minor >= 0);
ALTER TABLE financial_payment_intents ADD COLUMN IF NOT EXISTS capture_journal_id uuid REFERENCES financial_journals(id);
CREATE TABLE IF NOT EXISTS financial_postings (
  id bigserial PRIMARY KEY, journal_id uuid NOT NULL REFERENCES financial_journals(id), currency char(3) NOT NULL,
  account text NOT NULL, debit_minor bigint NOT NULL DEFAULT 0 CHECK (debit_minor >= 0),
  credit_minor bigint NOT NULL DEFAULT 0 CHECK (credit_minor >= 0),
  CHECK ((debit_minor = 0) <> (credit_minor = 0))
);
CREATE TABLE IF NOT EXISTS financial_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), provider text NOT NULL, provider_event_id text NOT NULL,
  event_type text NOT NULL, payload jsonb NOT NULL, correlation_id uuid NOT NULL, status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(), last_error text,
  received_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz, UNIQUE(provider, provider_event_id)
);
CREATE TABLE IF NOT EXISTS financial_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), topic text NOT NULL, aggregate_id text NOT NULL, payload jsonb NOT NULL,
  correlation_id uuid NOT NULL, status text NOT NULL DEFAULT 'pending', attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(), last_error text, locked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz
);
ALTER TABLE financial_outbox ADD COLUMN IF NOT EXISTS locked_at timestamptz;
CREATE TABLE IF NOT EXISTS financial_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), provider text NOT NULL, currency char(3) NOT NULL,
  provider_total_minor bigint NOT NULL, ledger_total_minor bigint NOT NULL, difference_minor bigint NOT NULL,
  evidence_reference text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS financial_campaign_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), project_id text NOT NULL, milestone_id text NOT NULL,
  creator_id text NOT NULL, requested_by text NOT NULL, currency char(3) NOT NULL,
  gross_amount_minor bigint NOT NULL CHECK (gross_amount_minor > 0),
  owner_proceeds_minor bigint NOT NULL CHECK (owner_proceeds_minor > 0),
  success_fee_minor bigint NOT NULL CHECK (success_fee_minor >= 0),
  ledger_journal_id uuid NOT NULL REFERENCES financial_journals(id), idempotency_key text NOT NULL UNIQUE,
  payout_status text NOT NULL DEFAULT 'not_started' CHECK (payout_status IN ('not_started', 'submitted', 'paid', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(project_id, milestone_id)
);
CREATE TABLE IF NOT EXISTS financial_chain_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), chain_id bigint NOT NULL CHECK (chain_id > 0),
  contract_address text NOT NULL, transaction_hash text NOT NULL, event_identity text NOT NULL,
  payment_intent_id uuid REFERENCES financial_payment_intents(id), release_id uuid REFERENCES financial_campaign_releases(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((payment_intent_id IS NOT NULL) <> (release_id IS NOT NULL)),
  UNIQUE(chain_id, transaction_hash), UNIQUE(chain_id, contract_address, event_identity)
);
CREATE TABLE IF NOT EXISTS financial_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_type text NOT NULL, aggregate_type text NOT NULL, aggregate_id text NOT NULL,
 deduplication_key text NOT NULL UNIQUE, payload jsonb NOT NULL, status text NOT NULL CHECK(status IN ('pending','processing','succeeded','retry','dead_letter')) DEFAULT 'pending',
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts >= 0), max_attempts integer NOT NULL DEFAULT 6 CHECK(max_attempts > 0), available_at timestamptz NOT NULL DEFAULT now(), claimed_at timestamptz, claimed_by text,
 last_error_code text, last_error_message_safe text, completed_at timestamptz, dead_lettered_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS financial_jobs_due_idx ON financial_jobs (status, available_at, created_at);
CREATE TABLE IF NOT EXISTS financial_payout_destinations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), creator_id text NOT NULL, provider text NOT NULL CHECK(provider='flutterwave'), provider_recipient_id text NOT NULL UNIQUE, destination_type text NOT NULL CHECK(destination_type IN('bank','mobile_money')), currency char(3) NOT NULL CHECK(currency='UGX'), masked_display text NOT NULL, provider_metadata jsonb NOT NULL DEFAULT '{}'::jsonb, status text NOT NULL CHECK(status IN('verified','disabled')), verified_at timestamptz NOT NULL, disabled_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS financial_payout_transfers (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), release_id uuid NOT NULL UNIQUE REFERENCES financial_campaign_releases(id), creator_id text NOT NULL, payout_destination_id uuid NOT NULL REFERENCES financial_payout_destinations(id), amount_minor bigint NOT NULL CHECK(amount_minor>0), currency char(3) NOT NULL, provider text NOT NULL CHECK(provider='flutterwave'), keibo_reference text NOT NULL UNIQUE, provider_transfer_id text UNIQUE, idempotency_key text NOT NULL UNIQUE, state text NOT NULL CHECK(state IN('not_started','pending','processing','paid','failed')), provider_status text, failure_code text, failure_message_safe text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), dispatched_at timestamptz, paid_at timestamptz, failed_at timestamptz);
CREATE TABLE IF NOT EXISTS financial_receipt_eligibilities (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), payment_intent_id uuid NOT NULL UNIQUE REFERENCES financial_payment_intents(id), user_id text NOT NULL, investor_wallet text NOT NULL, campaign_id bigint NOT NULL CHECK(campaign_id>=0), amount_minor bigint NOT NULL CHECK(amount_minor>0), chain_id bigint NOT NULL CHECK(chain_id>0), policy_version text NOT NULL, canonical_policy_payload text NOT NULL, policy_hash text NOT NULL CHECK(policy_hash ~ '^0x[0-9a-f]{64}$'), eligibility_signature text NOT NULL CHECK(eligibility_signature ~ '^0x[0-9a-fA-F]+$'), nonce numeric(78,0) NOT NULL UNIQUE CHECK(nonce>=0), expires_at timestamptz NOT NULL, status text NOT NULL CHECK(status IN('PENDING','AUTHORIZED','CONSUMED','EXPIRED','FAILED')), used_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE financial_receipt_eligibilities ADD COLUMN IF NOT EXISTS eligibility_signature text;
CREATE UNIQUE INDEX IF NOT EXISTS financial_receipt_eligibilities_wallet_nonce_idx ON financial_receipt_eligibilities(investor_wallet, nonce);
CREATE TABLE IF NOT EXISTS financial_receipt_issuances (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), eligibility_id uuid NOT NULL UNIQUE REFERENCES financial_receipt_eligibilities(id), payment_intent_id uuid NOT NULL UNIQUE REFERENCES financial_payment_intents(id), state text NOT NULL CHECK(state IN('PENDING','AUTHORIZED','SUBMITTED','ISSUED','FAILED','REVOKED')), tx_hash text UNIQUE, chain_id bigint NOT NULL CHECK(chain_id>0), contract_address text NOT NULL, receipt_token_id text, block_number bigint, transaction_index integer, log_index integer, event_identity text UNIQUE, failure_code text, failure_message_safe text, submitted_at timestamptz, issued_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS financial_receipt_revocations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), issuance_id uuid NOT NULL UNIQUE REFERENCES financial_receipt_issuances(id), requested_by text NOT NULL, reason_hash text NOT NULL CHECK(reason_hash ~ '^0x[0-9a-f]{64}$'), tx_hash text UNIQUE, state text NOT NULL CHECK(state IN('PENDING','SUBMITTED','REVOKED','FAILED')), block_number bigint, log_index integer, event_identity text UNIQUE, failure_code text, failure_message_safe text, requested_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE OR REPLACE FUNCTION reject_financial_ledger_mutation() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'financial journals and postings are immutable'; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS financial_journals_immutable ON financial_journals;
CREATE TRIGGER financial_journals_immutable BEFORE UPDATE OR DELETE ON financial_journals
FOR EACH ROW EXECUTE FUNCTION reject_financial_ledger_mutation();
DROP TRIGGER IF EXISTS financial_postings_immutable ON financial_postings;
CREATE TRIGGER financial_postings_immutable BEFORE UPDATE OR DELETE ON financial_postings
FOR EACH ROW EXECUTE FUNCTION reject_financial_ledger_mutation();
`;
