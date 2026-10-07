import { canonicalKycStatus } from './kyc-state.util';
import { KycApplicationStatus as Status } from './interfaces/kyc.interface';
import { KYCStatus } from '../../common/enums/role.enum';
describe('Canonical KYC state', () => {
  it.each([undefined, Status.UNVERIFIED, Status.DRAFT, Status.EXPIRED])(
    'fails closed for %s',
    (status) => {
      expect(canonicalKycStatus(status)).toBe(KYCStatus.NOT_VERIFIED);
    },
  );
  it('only grants verified status for an approved application', () => {
    expect(canonicalKycStatus(Status.APPROVED)).toBe(KYCStatus.VERIFIED);
    expect(canonicalKycStatus(Status.REJECTED)).toBe(KYCStatus.REJECTED);
    expect(canonicalKycStatus(Status.NEEDS_MORE_INFO)).toBe(KYCStatus.PENDING);
  });
});
