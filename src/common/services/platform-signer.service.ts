import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Abi, Address, Hash } from 'viem';

export interface PlatformWriteRequest {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
}

/**
 * Boundary for privileged contract writes. No raw-key implementation exists.
 * A later reviewed adapter may submit through a multisig, managed signer, or HSM.
 */
@Injectable()
export class PlatformSignerService {
  readonly provider: string;

  constructor(private readonly configService: ConfigService) {
    this.provider =
      this.configService.get<string>('PLATFORM_SIGNER_PROVIDER')?.trim() ||
      'disabled';
    if (this.provider !== 'disabled') {
      throw new Error(
        `Unsupported PLATFORM_SIGNER_PROVIDER: ${this.provider}. Privileged signing remains disabled.`,
      );
    }
  }

  writeContract(request: PlatformWriteRequest): Promise<Hash> {
    void request;
    return Promise.reject(
      new ServiceUnavailableException(
        'Privileged blockchain signing is disabled pending managed-signer approval',
      ),
    );
  }
}
