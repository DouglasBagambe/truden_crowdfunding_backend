# KEIBO backend

NestJS API for KEIBO authentication, campaigns, KYC orchestration, payments,
and the authoritative double-entry financial ledger.

## Local verification

Use Node 22. The repository lockfile is authoritative.

```bash
npm ci --ignore-scripts --no-audit --no-fund
npm run quality:changed
npm run build
npm run test:unit -- --runInBand
npm audit --omit=dev --audit-level=high
```

The repository-local `compose.financial-test.yml` starts disposable PostgreSQL
and Redis test fixtures. It is not a production deployment prescription. With
those fixtures running, apply the idempotent schema twice and run the hard-fail
integration suite:

```bash
npm run financial:migrate
npm run financial:migrate
npm run test:financial
```

CI also starts disposable MongoDB for the auth integration suite. CI values are
non-secret, local to the job, and must never be copied into a deployment.

## Production runtime contract

Build one immutable Node 22 image with `npm ci` and `npm run build`, then run it
as two separately scalable processes:

- Web: `node dist/main` with `FINANCIAL_WORKERS_ENABLED=false`.
- Financial worker: `node dist/financial-worker` from the same reviewed image with
  `FINANCIAL_WORKERS_ENABLED=true`, isolated from public ingress. Until a
  staging migration, queue, reconciliation, and rollback drill is verified, do
  not enable this process in production.

The platform must provide managed PostgreSQL for the financial ledger, Redis
for rate limiting and the durable financial event stream, MongoDB for
application documents, and durable object storage for attachments. Local disk
is ephemeral and must not hold authoritative uploads or financial evidence.

Run `npm run financial:migrate` as a one-off release job before starting the new
web or worker revision. The SQL is additive and idempotent, so CI runs it twice.
Never roll the database backward destructively. If application rollback is
needed, retain the migrated schema and roll the image back; correct data or
schema defects with a reviewed forward migration and a recorded recovery plan.

Expose a process liveness endpoint at `/api/health/live` and use
`/api/financial/health/ready` for PostgreSQL and Redis readiness. Do not route
traffic or start financial consumption until readiness is healthy.

### Environment names and validation

Use a secret manager and set names only from `.env.example.prod`. Core runtime
configuration includes `NODE_ENV`, `PORT`, `TRUST_PROXY`, `FRONTEND_URL`,
`BACKEND_URL`, `CORS_ORIGIN`, `MONGO_URI`, `FINANCIAL_DATABASE_URL`, `REDIS_URL`,
`RATE_LIMIT_STORE`, `JWT_SECRET`, `REFRESH_TOKEN_SECRET`,
`PASSWORD_RESET_SECRET`, `CSRF_SECRET`, `JWT_ISSUER`, `JWT_AUDIENCE`,
`COOKIE_SECURE`, `COOKIE_SAME_SITE`, `COOKIE_DOMAIN`, `SIWE_DOMAIN`, `SIWE_URI`,
and `SIWE_CHAIN_IDS`.

Provider-specific names are `DPO_API_URL`, `DPO_PAYMENT_URL`,
`DPO_COMPANY_TOKEN`, `DPO_FEE_RATE_BPS`, `DPO_FEE_VAT_RATE_BPS`,
`KEIBO_INBOUND_FEE_RATE_BPS`, `FLUTTERWAVE_PUBLIC_KEY`,
`FLUTTERWAVE_SECRET_KEY`, `FLUTTERWAVE_ENCRYPTION_KEY`,
`FLUTTERWAVE_WEBHOOK_SECRET`, `KYC_PROVIDER`, `KYC_PROVIDER_MODE`,
`DIDIT_API_KEY`, `DIDIT_CLIENT_ID`, `DIDIT_WORKFLOW_ID`,
`DIDIT_WEBHOOK_SECRET`, `SENDGRID_API_KEY`, and `EMAIL_FROM`. Blockchain names
are `CHAIN_ID`, `CHAIN_NAME`, `RPC_URL`, `ESCROW_CONTRACT_ADDRESS`,
`NFT_CONTRACT_ADDRESS`, `TREASURY_CONTRACT_ADDRESS`,
`VOTING_CONTRACT_ADDRESS`, `DEALROOM_CONTRACT_ADDRESS`, and
`PLATFORM_SIGNER_PROVIDER`.

Production validation rejects missing core values, placeholders, insecure URLs,
wildcard CORS, short secrets, insecure cookies, bypass modes, dummy KYC, sandbox
KYC, and raw administrator private keys. Never bake values into an image, log
them, or reuse CI values.

### Feature gates

Default all risky capabilities closed:

- Provider settlement: keep `FINANCIAL_WORKERS_ENABLED=false` until provider
  credentials, signed callback verification, migration, reconciliation,
  alerting, and worker rollback have passed staging.
- ROI: keep `INVESTMENTS_TEST_MODE=false` and
  `ROI_REQUIRE_ONCHAIN_PROVISIONING=true`; do not enable until reviewed contract
  addresses and managed signing are approved.
- NFT minting: keep `ROI_DISABLE_NFT_MINTING=true`.
- Wallet deposits and payouts: remain disabled until ledger-backed adapters,
  provider settlement, limits, reconciliation, and refund drills pass.
- Marketplace and crypto escrow: keep `ENABLE_NFT_MARKETPLACE=false` and
  `BLOCKCHAIN_FEATURES_ENABLED=false` until contract and operational approval.
- Notifications: leave provider credentials absent until sender-domain,
  delivery, retry, privacy, and alerting checks pass. Notification failure must
  not fabricate business success.
- Authentication/KYC bypasses: `AUTH_EMAIL_BYPASS=false`, `KYC_BYPASS=false`,
  and `DIDIT_SANDBOX=false` in production.

## Container requirements

The image must be reproducible, immutable, minimal, vulnerability-scanned, and
pinned by digest for promotion. Run as a non-root user on a read-only filesystem
with only a bounded temporary directory. Configure liveness/readiness checks,
graceful `SIGTERM` handling with sufficient drain time, structured stdout/stderr
logs without secrets or PII, and explicit CPU/memory requests and limits.
Existing formal Docker, Kubernetes, and ArgoCD practices may continue once they
satisfy this contract; this application repository does not prescribe or alter
the deployment repository.
