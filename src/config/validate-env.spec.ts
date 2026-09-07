import { validateEnvironment } from './validate-env';

const productionEnvironment = (): Record<string, unknown> => ({
  NODE_ENV: 'production',
  MONGO_URI: 'mongodb://database.internal:27017/keibo',
  JWT_SECRET: 'j'.repeat(48),
  REFRESH_TOKEN_SECRET: 'r'.repeat(48),
  PASSWORD_RESET_SECRET: 'p'.repeat(48),
  CSRF_SECRET: 'c'.repeat(48),
  JWT_ISSUER: 'keibo-api',
  JWT_AUDIENCE: 'keibo-web',
  REDIS_URL: 'redis://cache.internal:6379',
  FINANCIAL_DATABASE_URL: 'postgresql://financial.internal:5432/keibo',
  FRONTEND_URL: 'https://app.keibo.africa',
  BACKEND_URL: 'https://api.keibo.africa',
  CORS_ORIGIN: 'https://app.keibo.africa,https://preview.keibo.africa',
  TRUST_PROXY: '1',
  COOKIE_SECURE: 'true',
  COOKIE_SAME_SITE: 'lax',
  SIWE_DOMAIN: 'app.keibo.africa',
  SIWE_URI: 'https://app.keibo.africa',
  SIWE_CHAIN_IDS: '1,8453',
  AUTH_EMAIL_BYPASS: 'false',
  KYC_BYPASS: 'false',
  INVESTMENTS_TEST_MODE: 'false',
  BLOCKCHAIN_FEATURES_ENABLED: 'false',
  ENABLE_NFT_MARKETPLACE: 'false',
  ROI_DISABLE_NFT_MINTING: 'true',
  KYC_PROVIDER: 'didit',
  KYC_PROVIDER_MODE: 'live',
  DIDIT_SANDBOX: 'false',
  PLATFORM_SIGNER_PROVIDER: 'disabled',
});

describe('validateEnvironment', () => {
  it('accepts an explicit fail-closed production configuration', () => {
    const env = productionEnvironment();
    expect(validateEnvironment(env)).toBe(env);
  });

  it.each([
    'AUTH_EMAIL_BYPASS',
    'KYC_BYPASS',
    'INVESTMENTS_TEST_MODE',
    'BLOCKCHAIN_FEATURES_ENABLED',
    'ENABLE_NFT_MARKETPLACE',
  ])('rejects production bypass %s', (name) => {
    expect(() =>
      validateEnvironment({ ...productionEnvironment(), [name]: 'true' }),
    ).toThrow(name);
  });

  it('rejects missing and placeholder secrets without returning their values', () => {
    expect(() =>
      validateEnvironment({ ...productionEnvironment(), JWT_SECRET: '' }),
    ).toThrow('JWT_SECRET is required');
    expect(() =>
      validateEnvironment({
        ...productionEnvironment(),
        JWT_SECRET: 'replace-with-a-real-production-secret',
      }),
    ).toThrow('JWT_SECRET');
  });

  it('rejects wildcard origins and an enabled signer', () => {
    expect(() =>
      validateEnvironment({ ...productionEnvironment(), CORS_ORIGIN: '*' }),
    ).toThrow('CORS_ORIGIN');
    expect(() =>
      validateEnvironment({
        ...productionEnvironment(),
        PLATFORM_SIGNER_PROVIDER: 'local',
      }),
    ).toThrow('PLATFORM_SIGNER_PROVIDER');
  });
});
