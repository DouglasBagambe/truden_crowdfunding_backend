import { ConfigService } from '@nestjs/config';
import { ExecutionContext, GoneException } from '@nestjs/common';
import { InvestmentLaunchGuard } from './investment-launch.guard';
import { hasBackendRoiAccess } from '../utils/roi-access.util';

const context = (path: string) =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ path }) }),
  }) as ExecutionContext;
const config = (enabled?: string) =>
  new ConfigService({
    INVESTMENTS_ENABLED: enabled,
    ROI_ACCESS_MODE: 'PUBLIC',
    ROI_ALLOWED_USER_IDS: '*',
  });

describe('Charity-first launch boundary', () => {
  it.each([
    '/api/investments/my',
    '/api/marketplace/listings',
    '/api/nfts',
    '/api/financial/onchain-contributions',
    '/api/financial/receipts/123/issue',
    '/api/projects/123/provisioning/confirm',
    '/api/deal-room/123',
  ])('blocks direct investment access at %s', (path) => {
    expect(() =>
      new InvestmentLaunchGuard(config()).canActivate(context(path)),
    ).toThrow(GoneException);
  });
  it.each([
    '/api/projects',
    '/api/projects/donations/me',
    '/api/projects/123',
    '/api/wallet/withdraw',
    '/api/financial/payment-intents',
    '/api/financial/payout-destinations',
    '/api/financial/payouts',
    '/api/admin/projects/123/decision',
    '/api/kyc',
  ])('preserves charity/auth/admin route %s', (path) => {
    expect(new InvestmentLaunchGuard(config()).canActivate(context(path))).toBe(
      true,
    );
  });
  it('denies ROI even with public access or a wildcard allowlist until explicitly released', () => {
    expect(hasBackendRoiAccess('any-user', config())).toBe(false);
    expect(hasBackendRoiAccess('any-user', config('false'))).toBe(false);
    expect(hasBackendRoiAccess('any-user', config('true'))).toBe(true);
    expect(
      new InvestmentLaunchGuard(config('true')).canActivate(
        context('/api/investments/my'),
      ),
    ).toBe(true);
  });
});
