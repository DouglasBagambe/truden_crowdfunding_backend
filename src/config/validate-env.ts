const PLACEHOLDER_PATTERN =
  /(changeme|example|placeholder|replace-with|your[_-]|default|xxxxx|unsafe|test-secret|\.invalid)/i;

function stringValue(value: unknown, fallback = ''): string {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}

function required(env: Record<string, unknown>, name: string): string {
  const value = stringValue(env[name]).trim();
  if (!value) {
    throw new Error(`Invalid production configuration: ${name} is required`);
  }
  if (PLACEHOLDER_PATTERN.test(value)) {
    throw new Error(
      `Invalid production configuration: ${name} cannot use a placeholder`,
    );
  }
  return value;
}

function secureSecret(env: Record<string, unknown>, name: string): void {
  const value = required(env, name);
  if (value.length < 32 || PLACEHOLDER_PATTERN.test(value)) {
    throw new Error(
      `Invalid production configuration: ${name} must be a non-placeholder secret of at least 32 characters`,
    );
  }
}

function assertBooleanOff(env: Record<string, unknown>, name: string): void {
  if (stringValue(env[name]).trim().toLowerCase() === 'true') {
    throw new Error(`Invalid production configuration: ${name} must be false`);
  }
}

function validateUrl(value: string, name: string, httpsOnly = true): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      `Invalid production configuration: ${name} must be a valid URL`,
    );
  }
  if (httpsOnly && url.protocol !== 'https:') {
    throw new Error(`Invalid production configuration: ${name} must use HTTPS`);
  }
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
    throw new Error(
      `Invalid production configuration: ${name} cannot target localhost`,
    );
  }
}

export function validateEnvironment(
  env: Record<string, unknown>,
): Record<string, unknown> {
  const nodeEnv = stringValue(env.NODE_ENV, 'development').trim().toLowerCase();
  if (!['development', 'test', 'production'].includes(nodeEnv)) {
    throw new Error(
      'Invalid configuration: NODE_ENV must be development, test or production',
    );
  }

  if (nodeEnv !== 'production') {
    return env;
  }

  required(env, 'MONGO_URI');
  secureSecret(env, 'JWT_SECRET');
  secureSecret(env, 'REFRESH_TOKEN_SECRET');
  secureSecret(env, 'PASSWORD_RESET_SECRET');
  secureSecret(env, 'CSRF_SECRET');
  required(env, 'JWT_ISSUER');
  required(env, 'JWT_AUDIENCE');
    if (stringValue(env.FINANCIAL_WORKERS_ENABLED).trim().toLowerCase() === 'true') {
    required(env, 'REDIS_URL');
    required(env, 'FINANCIAL_DATABASE_URL');
  }

  const frontendUrl = required(env, 'FRONTEND_URL');
  const backendUrl = required(env, 'BACKEND_URL');
  validateUrl(frontendUrl, 'FRONTEND_URL');
  validateUrl(backendUrl, 'BACKEND_URL');

  const origins = required(env, 'CORS_ORIGIN')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (origins.length === 0 || origins.some((origin) => origin === '*')) {
    throw new Error(
      'Invalid production configuration: CORS_ORIGIN must be an explicit allowlist',
    );
  }
  for (const origin of origins) validateUrl(origin, 'CORS_ORIGIN');

  required(env, 'TRUST_PROXY');
  if (stringValue(env.COOKIE_SECURE).toLowerCase() !== 'true') {
    throw new Error(
      'Invalid production configuration: COOKIE_SECURE must be true',
    );
  }
  const sameSite = required(env, 'COOKIE_SAME_SITE').toLowerCase();
  if (!['lax', 'strict'].includes(sameSite)) {
    throw new Error(
      'Invalid production configuration: COOKIE_SAME_SITE must be lax or strict',
    );
  }

  required(env, 'SIWE_DOMAIN');
  validateUrl(required(env, 'SIWE_URI'), 'SIWE_URI');
  const chainIds = required(env, 'SIWE_CHAIN_IDS')
    .split(',')
    .map((value) => Number(value.trim()));
  if (chainIds.some((value) => !Number.isSafeInteger(value) || value <= 0)) {
    throw new Error(
      'Invalid production configuration: SIWE_CHAIN_IDS is invalid',
    );
  }

  assertBooleanOff(env, 'AUTH_EMAIL_BYPASS');
  assertBooleanOff(env, 'KYC_BYPASS');
  assertBooleanOff(env, 'INVESTMENTS_TEST_MODE');
  assertBooleanOff(env, 'BLOCKCHAIN_FEATURES_ENABLED');
  assertBooleanOff(env, 'ENABLE_NFT_MARKETPLACE');
  if (stringValue(env.ROI_DISABLE_NFT_MINTING).toLowerCase() !== 'true') {
    throw new Error(
      'Invalid production configuration: ROI_DISABLE_NFT_MINTING must be true',
    );
  }

  const kycProvider = required(env, 'KYC_PROVIDER').toLowerCase();
  if (kycProvider === 'dummy') {
    throw new Error(
      'Invalid production configuration: KYC_PROVIDER cannot be dummy',
    );
  }
  if (required(env, 'KYC_PROVIDER_MODE').toLowerCase() !== 'live') {
    throw new Error(
      'Invalid production configuration: KYC_PROVIDER_MODE must be live',
    );
  }
  assertBooleanOff(env, 'DIDIT_SANDBOX');

  const signerProvider = stringValue(
    env.PLATFORM_SIGNER_PROVIDER,
    'disabled',
  ).toLowerCase();
  if (signerProvider !== 'disabled') {
    throw new Error(
      'Invalid production configuration: PLATFORM_SIGNER_PROVIDER must remain disabled until an approved managed signer is integrated',
    );
  }
  if (env.ADMIN_PRIVATE_KEY || env.BLOCKCHAIN_ADMIN_PRIVATE_KEY) {
    throw new Error(
      'Invalid production configuration: raw administrator signing keys are prohibited',
    );
  }

  return env;
}
