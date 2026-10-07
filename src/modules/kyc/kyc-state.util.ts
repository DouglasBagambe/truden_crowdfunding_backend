import { KYCStatus } from '../../common/enums/role.enum';
import { KycApplicationStatus } from './interfaces/kyc.interface';

export function canonicalKycStatus(status?: KycApplicationStatus): KYCStatus {
  switch (status) {
    case KycApplicationStatus.APPROVED:
      return KYCStatus.VERIFIED;
    case KycApplicationStatus.REJECTED:
      return KYCStatus.REJECTED;
    case KycApplicationStatus.PENDING:
    case KycApplicationStatus.SUBMITTED_TO_PROVIDER:
    case KycApplicationStatus.UNDER_REVIEW:
    case KycApplicationStatus.NEEDS_MORE_INFO:
      return KYCStatus.PENDING;
    default:
      return KYCStatus.NOT_VERIFIED;
  }
}
