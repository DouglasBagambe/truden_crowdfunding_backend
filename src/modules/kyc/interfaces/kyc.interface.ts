import { KYCStatus } from '../../../common/enums/role.enum';

export enum KycApplicationStatus {
  UNVERIFIED = 'UNVERIFIED',
  DRAFT = 'DRAFT',
  PENDING = 'PENDING',
  SUBMITTED_TO_PROVIDER = 'SUBMITTED_TO_PROVIDER',
  UNDER_REVIEW = 'UNDER_REVIEW',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  NEEDS_MORE_INFO = 'NEEDS_MORE_INFO',
  EXPIRED = 'EXPIRED',
}

export enum KycDocumentType {
  ID_FRONT = 'ID_FRONT',
  ID_BACK = 'ID_BACK',
  PASSPORT = 'PASSPORT',
  PROOF_OF_ADDRESS = 'PROOF_OF_ADDRESS',
  SELFIE = 'SELFIE',
  OTHER = 'OTHER',
}

export type KycLevel = 'BASIC' | 'ENHANCED';

export interface KycDocumentView {
  id?: string;
  type: KycDocumentType;
  label?: string;
  storageKey: string;
  url?: string;
  mimeType?: string;
  sizeBytes?: number;
  uploadedAt: Date;
  metadata?: Record<string, any>;
}

export interface KycProfileView {
  id: string;
  userId: string;
  status: KycApplicationStatus;
  userKycStatus: KYCStatus;
  level?: KycLevel | null;
  firstName?: string | null;
  lastName?: string | null;
  dateOfBirth?: Date | null;
  nationality?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  stateOrProvince?: string | null;
  postalCode?: string | null;
  country?: string | null;
  idType?: string | null;
  idNumberLast4?: string | null;
  idCountry?: string | null;
  idExpiryDate?: Date | null;
  providerName?: string | null;
  providerReference?: string | null;
  providerStatus?: string | null;
  submittedAt?: Date | null;
  approvedAt?: Date | null;
  rejectedAt?: Date | null;
  rejectionReason?: string | null;
  manualNotes?: string | null;
  documents: KycDocumentView[];
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminKycProfileListItem {
  id: string;
  userId: string;
  status: KycApplicationStatus;
  userKycStatus: KYCStatus;
  level?: KycLevel | null;
  submittedAt?: Date | null;
  approvedAt?: Date | null;
  rejectedAt?: Date | null;
  rejectionReason?: string | null;
  documentCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface KycProfileListResponse {
  items: AdminKycProfileListItem[];
  total: number;
  page: number;
  pageSize: number;
}
