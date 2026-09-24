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
