import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createWalletClient,
  http,
  type Abi,
  type Address,
  type Hash,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

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
  private readonly walletClient?: ReturnType<typeof createWalletClient>;
  private readonly expectedChainId?: number;

  constructor(private readonly configService: ConfigService) {
    this.provider =
      this.configService.get<string>('PLATFORM_SIGNER_PROVIDER')?.trim() ||
      'disabled';
    if (this.provider === 'disabled') return;
    if (this.provider !== 'local') {
      throw new Error(
        `Unsupported PLATFORM_SIGNER_PROVIDER: ${this.provider}. Privileged signing remains disabled.`,
      );
    }

    const nodeEnv =
      this.configService.get<string>('NODE_ENV')?.trim().toLowerCase() ||
      'development';
    if (nodeEnv === 'production') {
      throw new Error(
        'PLATFORM_SIGNER_PROVIDER=local is prohibited in production',
      );
    }
    const privateKey = this.configService
      .get<string>('UAT_PLATFORM_SIGNER_PRIVATE_KEY')
      ?.trim();
    const rpcUrl = this.configService.get<string>('RPC_URL')?.trim();
    const expectedChainId = Number(this.configService.get<string>('CHAIN_ID'));
    if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
      throw new Error(
        'UAT_PLATFORM_SIGNER_PRIVATE_KEY must be a valid test-only private key',
      );
    }
    if (!rpcUrl) {
      throw new Error('RPC_URL is required for the local UAT signer');
    }
    if (!Number.isSafeInteger(expectedChainId) || expectedChainId <= 0) {
      throw new Error('CHAIN_ID is required for the local UAT signer');
    }
    this.expectedChainId = expectedChainId;
    this.walletClient = createWalletClient({
      account: privateKeyToAccount(privateKey as Hex),
      transport: http(rpcUrl),
    });
  }

  async writeContract(request: PlatformWriteRequest): Promise<Hash> {
    if (!this.walletClient) {
      throw new ServiceUnavailableException(
        'Privileged blockchain signing is disabled pending managed-signer approval',
      );
    }
    const actualChainId = await this.walletClient.getChainId();
    if (actualChainId !== this.expectedChainId) {
      throw new ServiceUnavailableException(
        'Signer RPC chain ID does not match CHAIN_ID',
      );
    }
    return this.walletClient.writeContract({
      address: request.address,
      abi: request.abi,
      functionName: request.functionName,
      args: request.args,
    } as never) as Promise<Hash>;
  }
}
