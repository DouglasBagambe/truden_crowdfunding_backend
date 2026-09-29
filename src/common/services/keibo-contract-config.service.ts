import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isAddress, zeroAddress, type Address } from 'viem';

function isConfigured(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Detects the KEIBO runtime without attempting to validate or instantiate a
 * contract client. This is deliberately broader than getRequired(): an
 * incomplete KEIBO configuration must still never fall back to a legacy ABI.
 */
export function isKeiboRuntimeEnabled(configService: ConfigService): boolean {
  const get = (rawKey: string, configKey: string): unknown =>
    configService.get<unknown>(rawKey) ?? configService.get<unknown>(configKey);
  const receipt = get(
    'KEIBO_RECEIPT_CONTRACT_ADDRESS',
    'blockchain.keiboContracts.receipt',
  );
  if (isConfigured(receipt)) return true;

  const enabled = get('BLOCKCHAIN_FEATURES_ENABLED', 'blockchain.enabled');
  const blockchainEnabled = enabled === true || enabled === 'true';
  if (!blockchainEnabled) return false;

  return [
    get('KEIBO_ESCROW_CONTRACT_ADDRESS', 'blockchain.keiboContracts.escrow'),
    get(
      'KEIBO_GOVERNANCE_CONTRACT_ADDRESS',
      'blockchain.keiboContracts.governance',
    ),
    get(
      'KEIBO_EVIDENCE_CONTRACT_ADDRESS',
      'blockchain.keiboContracts.evidence',
    ),
  ].some(isConfigured);
}

export interface KeiboContractConfig {
  rpcUrl: string;
  chainId: number;
  escrow: Address;
  governance: Address;
  receipt: Address;
  evidence: Address;
  eligibilitySigner: Address;
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
    if (configured !== undefined)
      return configured === true || configured === 'true';
    return this.configService.get<boolean>('blockchain.enabled') === true;
  }

  isKeiboRuntimeEnabled(): boolean {
    return isKeiboRuntimeEnabled(this.configService);
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
      throw new ServiceUnavailableException(
        'RPC_URL must be a valid HTTP(S) URL',
      );
    }
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      throw new ServiceUnavailableException(
        'RPC_URL must be a valid HTTP(S) URL',
      );
    }

    const rawChainId =
      this.configService.get<unknown>('CHAIN_ID') ??
      this.configService.get<unknown>('blockchain.chainId');
    const chainId =
      typeof rawChainId === 'number'
        ? rawChainId
        : typeof rawChainId === 'string'
          ? Number(rawChainId)
          : Number.NaN;
    if (!Number.isSafeInteger(chainId) || chainId <= 0) {
      throw new ServiceUnavailableException(
        'CHAIN_ID must be a positive integer',
      );
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
      eligibilitySigner: this.requiredAddress(
        'KEIBO_ELIGIBILITY_SIGNER_ADDRESS',
        'blockchain.eligibilitySigner',
      ),
    };
  }

  private requiredString(rawKey: string, configKey: string): string {
    const value =
      this.configService.get<string>(rawKey)?.trim() ||
      this.configService.get<string>(configKey)?.trim();
    if (!value) {
      throw new ServiceUnavailableException(`${rawKey} is required`);
    }
    return value;
  }

  private requiredAddress(rawKey: string, configKey: string): Address {
    const value = this.requiredString(rawKey, configKey);
    if (!isAddress(value) || value.toLowerCase() === zeroAddress) {
      throw new ServiceUnavailableException(
        `${rawKey} must be a non-zero address`,
      );
    }
    return value;
  }
}
