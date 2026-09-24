import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  createPublicClient,
  decodeEventLog,
  http,
  isAddress,
  isHex,
  type Address,
  type Hash,
  type Hex,
} from 'viem';
import { KeiboContractConfigService } from '../../../common/services/keibo-contract-config.service';
import { PlatformSignerService } from '../../../common/services/platform-signer.service';

// Curated KeiboInvestmentReceipt ABI. It is never interchangeable with InvestmentNFT.
export const KEIBO_INVESTMENT_RECEIPT_ABI = [
  {
    type: 'function',
    name: 'nonces',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'settledAmount',
    stateMutability: 'view',
    inputs: [
      { name: '', type: 'uint256' },
      { name: '', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'issue',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'investor', type: 'address' },
      { name: 'campaignId', type: 'uint256' },
      { name: 'amount', type: 'uint256' },
      { name: 'expiresAt', type: 'uint64' },
      { name: 'policyHash', type: 'bytes32' },
      { name: 'eligibilitySignature', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'revoke',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'investor', type: 'address' },
      { name: 'campaignId', type: 'uint256' },
      { name: 'amount', type: 'uint256' },
      { name: 'reasonHash', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    type: 'event',
    name: 'ReceiptIssued',
    inputs: [
      { indexed: true, name: 'campaignId', type: 'uint256' },
      { indexed: true, name: 'investor', type: 'address' },
      { indexed: false, name: 'amount', type: 'uint256' },
      { indexed: false, name: 'policyHash', type: 'bytes32' },
    ],
  },
  {
    type: 'event',
    name: 'ReceiptRevoked',
    inputs: [
      { indexed: true, name: 'campaignId', type: 'uint256' },
      { indexed: true, name: 'investor', type: 'address' },
      { indexed: false, name: 'amount', type: 'uint256' },
      { indexed: false, name: 'reasonHash', type: 'bytes32' },
    ],
  },
] as const;

/**
 * Contract boundary only. Eligibility policy and durable issuance orchestration
 * must supply a signed, persisted policy record; this service invents neither.
 */
@Injectable()
export class KeiboInvestmentReceiptService {
  constructor(
    private readonly config: KeiboContractConfigService,
    private readonly signer: PlatformSignerService,
  ) {}

  async issue(params: {
    investor: Address;
    campaignId: string;
    amount: bigint;
    expiresAt: bigint;
    policyHash: Hex;
    eligibilitySignature: Hex;
    expectedNonce: bigint;
  }): Promise<Hash> {
    this.assertIssueInput(params);
    const { client, runtime } = await this.ready();
    const nonce = await client.readContract({
      address: runtime.receipt,
      abi: KEIBO_INVESTMENT_RECEIPT_ABI,
      functionName: 'nonces',
      args: [params.investor],
    });
    if (nonce !== params.expectedNonce)
      throw new ConflictException('Eligibility nonce is stale or replayed');
    const hash = await this.signer.writeContract({
      address: runtime.receipt,
      abi: KEIBO_INVESTMENT_RECEIPT_ABI,
      functionName: 'issue',
      args: [
        params.investor,
        BigInt(params.campaignId),
        params.amount,
        params.expiresAt,
        params.policyHash,
        params.eligibilitySignature,
      ],
    });
    await this.requireEvent(client, runtime.receipt, hash, 'ReceiptIssued');
    return hash;
  }

  async revoke(params: {
    investor: Address;
    campaignId: string;
    amount: bigint;
    reasonHash: Hex;
  }): Promise<Hash> {
    if (
      !isAddress(params.investor) ||
      !/^\d+$/.test(params.campaignId) ||
      params.amount <= 0n ||
      !this.bytes32(params.reasonHash)
    )
      throw new ConflictException('Invalid receipt revocation request');
    const { client, runtime } = await this.ready();
    const hash = await this.signer.writeContract({
      address: runtime.receipt,
      abi: KEIBO_INVESTMENT_RECEIPT_ABI,
      functionName: 'revoke',
      args: [
        params.investor,
        BigInt(params.campaignId),
        params.amount,
        params.reasonHash,
      ],
    });
    await this.requireEvent(client, runtime.receipt, hash, 'ReceiptRevoked');
    return hash;
  }

  private assertIssueInput(params: {
    investor: Address;
    campaignId: string;
    amount: bigint;
    expiresAt: bigint;
    policyHash: Hex;
    eligibilitySignature: Hex;
    expectedNonce: bigint;
  }) {
    if (
      !isAddress(params.investor) ||
      !/^\d+$/.test(params.campaignId) ||
      params.amount <= 0n ||
      params.expiresAt <= BigInt(Math.floor(Date.now() / 1000)) ||
      params.expectedNonce < 0n ||
      !this.bytes32(params.policyHash) ||
      !isHex(params.eligibilitySignature) ||
      params.eligibilitySignature === '0x'
    ) {
      throw new ConflictException(
        'Invalid or expired receipt eligibility evidence',
      );
    }
  }

  private async ready() {
    const runtime = this.config.getRequired();
    const client = createPublicClient({ transport: http(runtime.rpcUrl) });
    try {
      const [chainId, bytecode] = await Promise.all([
        client.getChainId(),
        client.getCode({ address: runtime.receipt }),
      ]);
      if (chainId !== runtime.chainId)
        throw new ServiceUnavailableException(
          'RPC chain ID does not match CHAIN_ID',
        );
      if (!bytecode || bytecode === '0x')
        throw new ServiceUnavailableException(
          'KEIBO receipt address has no deployed bytecode',
        );
      return { client, runtime };
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException(
        `Unable to validate KEIBO receipt runtime: ${error instanceof Error ? error.message : 'unknown RPC failure'}`,
      );
    }
  }

  private async requireEvent(
    client: ReturnType<typeof createPublicClient>,
    address: Address,
    hash: Hash,
    eventName: 'ReceiptIssued' | 'ReceiptRevoked',
  ) {
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success')
      throw new ConflictException(
        `KEIBO receipt ${eventName} transaction reverted`,
      );
    const found = receipt.logs.some((log) => {
      if (log.address.toLowerCase() !== address.toLowerCase()) return false;
      try {
        return (
          decodeEventLog({
            abi: KEIBO_INVESTMENT_RECEIPT_ABI,
            data: log.data,
            topics: log.topics,
          }).eventName === eventName
        );
      } catch {
        return false;
      }
    });
    if (!found)
      throw new ConflictException(`Missing ${eventName} receipt evidence`);
  }

  private bytes32(value: Hex): boolean {
    return /^0x[0-9a-fA-F]{64}$/.test(value);
  }
}
