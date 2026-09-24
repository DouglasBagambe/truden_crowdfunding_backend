import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isAddress, zeroAddress, type Address } from 'viem';

export interface KeiboContractConfig {
  rpcUrl: string;
  chainId: number;
  escrow: Address;
  governance: Address;
  receipt: Address;
  evidence: Address;
}

/**
 * The only configuration boundary for the new KEIBO contracts. Legacy address
 * variables intentionally remain separate so an address cannot silently be
 * paired with an incompatible ABI.
 */
@Injectable()
export class KeiboContractConfigService {
  constructor(private readonly configService: ConfigService) {}

  isEnabled(): boolean {
    const configured = this.configService.get<unknown>(
      'BLOCKCHAIN_FEATURES_ENABLED',
    );
    if (configured !== undefined) return configured === true || configured === 'true';
    return this.configService.get<boolean>('blockchain.enabled') === true;
  }

  getRequired(): KeiboContractConfig {
    if (!this.isEnabled()) {
      throw new ServiceUnavailableException(
        'KEIBO blockchain integration is disabled',
      );
    }

    const rpcUrl = this.requiredString('RPC_URL', 'blockchain.rpcUrl');
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rpcUrl);
    } catch {
      throw new ServiceUnavailableException('RPC_URL must be a valid HTTP(S) URL');
    }
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new ServiceUnavailableException('RPC_URL must be a valid HTTP(S) URL');
    }

    const rawChainId = this.configService.get<unknown>('CHAIN_ID') ??
      this.configService.get<unknown>('blockchain.chainId');
    const chainId =
      typeof rawChainId === 'number'
        ? rawChainId
        : typeof rawChainId === 'string'
          ? Number(rawChainId)
          : Number.NaN;
    if (!Number.isSafeInteger(chainId) || chainId <= 0) {
      throw new ServiceUnavailableException('CHAIN_ID must be a positive integer');
    }

    return {
      rpcUrl,
      chainId,
      escrow: this.requiredAddress(
        'KEIBO_ESCROW_CONTRACT_ADDRESS',
        'blockchain.keiboContracts.escrow',
      ),
      governance: this.requiredAddress(
        'KEIBO_GOVERNANCE_CONTRACT_ADDRESS',
        'blockchain.keiboContracts.governance',
      ),
      receipt: this.requiredAddress(
        'KEIBO_RECEIPT_CONTRACT_ADDRESS',
        'blockchain.keiboContracts.receipt',
      ),
      evidence: this.requiredAddress(
        'KEIBO_EVIDENCE_CONTRACT_ADDRESS',
        'blockchain.keiboContracts.evidence',
      ),
    };
  }

  private requiredString(rawKey: string, configKey: string): string {
    const value = this.configService.get<string>(rawKey)?.trim() ||
      this.configService.get<string>(configKey)?.trim();
    if (!value) {
      throw new ServiceUnavailableException(`${rawKey} is required`);
    }
    return value;
  }

  private requiredAddress(rawKey: string, configKey: string): Address {
    const value = this.requiredString(rawKey, configKey);
    if (!isAddress(value) || value.toLowerCase() === zeroAddress) {
      throw new ServiceUnavailableException(`${rawKey} must be a non-zero address`);
    }
    return value;
  }
}
