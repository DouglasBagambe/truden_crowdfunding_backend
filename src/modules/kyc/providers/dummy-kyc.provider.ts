import { Injectable } from '@nestjs/common';
import { IKycProviderService, KycProviderStatusResult, KycProviderSubmitResult } from './kyc-provider.interface';
import type { KycProfileDocument } from '../schemas/kyc-profile.schema';
import type { KycWebhookDto } from '../dto/kyc-webhook.dto';

@Injectable()
export class DummyKycProviderService implements IKycProviderService {
  getProviderName(): string {
    return 'dummy';
  }

  async submitApplication(
    profile: KycProfileDocument,
  ): Promise<KycProviderSubmitResult> {
    const reference = `dummy-${profile._id.toString()}`;

    const approved = !!profile.country && !!profile.idType;
    const status = approved ? 'APPROVED' : 'UNDER_REVIEW';

    return {
      reference,
      status,
      rawResponse: {
        provider: 'dummy',
        approved,
        profileId: profile._id.toString(),
      },
    };
  }

  async refreshStatus(
    profile: KycProfileDocument,
  ): Promise<KycProviderStatusResult> {
    const reference = profile.providerReference || `dummy-${profile._id.toString()}`;
    const status = profile.providerStatus || 'UNDER_REVIEW';

    return {
      reference,
      status,
      rawResponse: {
        provider: 'dummy',
        profileId: profile._id.toString(),
      },
    };
  }

  async handleWebhook(dto: KycWebhookDto): Promise<KycProviderStatusResult | null> {
    return {
      reference: dto.reference,
      status: dto.status,
      rawResponse: dto.payload ?? {},
    };
  }
}
