import type { KycProfileDocument } from '../schemas/kyc-profile.schema';
import type { KycWebhookDto } from '../dto/kyc-webhook.dto';

export interface KycProviderSubmitResult {
  reference: string;
  status: string;
  rawResponse?: Record<string, unknown>;
}

export interface KycProviderStatusResult {
  reference: string;
  status: string;
  rawResponse?: Record<string, unknown>;
}

export interface IKycProviderService {
  getProviderName(): string;
  submitApplication(
    profile: KycProfileDocument,
  ): Promise<KycProviderSubmitResult>;
  refreshStatus(profile: KycProfileDocument): Promise<KycProviderStatusResult>;
  handleWebhook(dto: KycWebhookDto): Promise<KycProviderStatusResult | null>;
}
