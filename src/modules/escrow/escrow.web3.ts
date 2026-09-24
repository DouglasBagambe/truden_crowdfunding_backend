import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  createPublicClient,
  decodeEventLog,
  encodeFunctionData,
  http,
  isHash,
  type Address,
  type Hash,
  type Hex,
} from 'viem';
import { KeiboContractConfigService } from '../../common/services/keibo-contract-config.service';
import { PlatformSignerService } from '../../common/services/platform-signer.service';
import { EscrowCurrency } from './types';

// Curated KEIBO escrow ABI. Legacy Escrow.json is deliberately not imported.
export const KEIBO_CAMPAIGN_ESCROW_ABI = [
  {
    type: 'function',
    name: 'campaigns',
    stateMutability: 'view',
    inputs: [{ type: 'uint256', name: '' }],
    outputs: [
      { type: 'address', name: 'creator' },
      { type: 'address', name: 'asset' },
      { type: 'uint128', name: 'cap' },
      { type: 'uint128', name: 'raised' },
      { type: 'uint64', name: 'deadline' },
      { type: 'uint8', name: 'state' },
    ],
  },
  {
    type: 'function',
    name: 'contribute',
    stateMutability: 'nonpayable',
    inputs: [
      { type: 'uint256', name: 'campaignId' },
      { type: 'uint128', name: 'amount' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'approveMilestone',
    stateMutability: 'nonpayable',
    inputs: [
      { type: 'uint256', name: 'campaignId' },
      { type: 'uint256', name: 'milestoneId' },
      { type: 'bytes32', name: 'evidenceHash' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'releaseMilestone',
    stateMutability: 'nonpayable',
    inputs: [
      { type: 'uint256', name: 'campaignId' },
      { type: 'uint256', name: 'milestoneId' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'refund',
    stateMutability: 'nonpayable',
    inputs: [{ type: 'uint256', name: 'campaignId' }],
    outputs: [],
  },
  {
    type: 'event',
    name: 'Contributed',
    inputs: [
      { indexed: true, name: 'campaignId', type: 'uint256' },
      { indexed: true, name: 'contributor', type: 'address' },
      { indexed: false, name: 'amount', type: 'uint256' },
    ],
  },
  {
    type: 'event',
    name: 'MilestoneReleased',
    inputs: [
      { indexed: true, name: 'campaignId', type: 'uint256' },
      { indexed: true, name: 'milestoneId', type: 'uint256' },
      { indexed: false, name: 'creatorAmount', type: 'uint256' },
      { indexed: false, name: 'feeAmount', type: 'uint256' },
    ],
  },
  {
    type: 'event',
    name: 'Refunded',
    inputs: [
      { indexed: true, name: 'campaignId', type: 'uint256' },
      { indexed: true, name: 'contributor', type: 'address' },
      { indexed: false, name: 'amount', type: 'uint256' },
    ],
  },
] as const;

/**
 * Testnet-only adapter for KeiboCampaignEscrow. It never sends a contribution,
 * creator release, or refund using a platform key: those functions use msg.sender
 * and must be signed by the actual contributor/creator wallet.
 */
@Injectable()
export class EscrowWeb3Service {
  constructor(
    private readonly keiboConfig: KeiboContractConfigService,
    private readonly platformSigner: PlatformSignerService,
  ) {}

  getRuntimeConfig() {
    return this.keiboConfig.getRequired();
  }

  async getCampaign(projectOnchainId: string) {
    const { client, config } = await this.readyClient();
    const campaign = (await client.readContract({
      address: config.escrow,
      abi: KEIBO_CAMPAIGN_ESCROW_ABI,
      functionName: 'campaigns',
      args: [this.uint(projectOnchainId, 'projectOnchainId')],
    })) as readonly [Address, Address, bigint, bigint, bigint, number];
    if (campaign[0] === '0x0000000000000000000000000000000000000000') {
      throw new ConflictException('KEIBO campaign does not exist');
    }
    return {
      creator: campaign[0],
      asset: campaign[1],
      cap: campaign[2],
      raised: campaign[3],
      deadline: campaign[4],
      state: campaign[5],
    };
  }

  async prepareContribution(params: {
    projectOnchainId: string;
    amount: bigint;
    currency: EscrowCurrency;
  }): Promise<{ to: Address; data: Hex }> {
    if (params.currency !== EscrowCurrency.USDC) {
      throw new ConflictException(
        'KEIBO escrow only supports its configured ERC-20 asset',
      );
    }
    if (params.amount <= 0n || params.amount > 2n ** 128n - 1n) {
      throw new ConflictException(
        'Contribution amount is outside uint128 range',
      );
    }
    const { config } = await this.readyClient();
    return {
      to: config.escrow,
      data: encodeFunctionData({
        abi: KEIBO_CAMPAIGN_ESCROW_ABI,
        functionName: 'contribute',
        args: [
          this.uint(params.projectOnchainId, 'projectOnchainId'),
          params.amount,
        ],
      }),
    };
  }

  /** Verify mined receipt evidence; it does not reserve the hash in the ledger. */
  async verifyDepositTx(params: {
    hash: Hash;
    projectOnchainId: string;
    investor: Address;
    amount: bigint;
  }): Promise<boolean> {
    const campaignId = this.uint(params.projectOnchainId, 'projectOnchainId');
    const args = await this.eventArgs(params.hash, 'Contributed');
    const event = args as {
      campaignId?: bigint;
      contributor?: Address;
      amount?: bigint;
    };
    return (
      event.campaignId === campaignId &&
      event.contributor?.toLowerCase() === params.investor.toLowerCase() &&
      event.amount === params.amount
    );
  }

  /** Only the campaign-manager boundary can approve an evidenced milestone. */
  async approveMilestoneOnchain(params: {
    projectOnchainId: string;
    milestoneId: string;
    evidenceHash: Hex;
  }): Promise<Hash> {
    if (!/^0x[0-9a-fA-F]{64}$/.test(params.evidenceHash)) {
      throw new ConflictException('evidenceHash must be bytes32');
    }
    const { client, config } = await this.readyClient();
    const hash = await this.platformSigner.writeContract({
      address: config.escrow,
      abi: KEIBO_CAMPAIGN_ESCROW_ABI,
      functionName: 'approveMilestone',
      args: [
        this.uint(params.projectOnchainId, 'projectOnchainId'),
        this.uint(params.milestoneId, 'milestoneId'),
        params.evidenceHash,
      ],
    });
    await this.successfulReceipt(client, hash, 'milestone approval');
    return hash;
  }

  async prepareRelease(params: {
    projectOnchainId: string;
    milestoneId: string;
  }): Promise<{ to: Address; data: Hex }> {
    const { config } = await this.readyClient();
    return {
      to: config.escrow,
      data: encodeFunctionData({
        abi: KEIBO_CAMPAIGN_ESCROW_ABI,
        functionName: 'releaseMilestone',
        args: [
          this.uint(params.projectOnchainId, 'projectOnchainId'),
          this.uint(params.milestoneId, 'milestoneId'),
        ],
      }),
    };
  }

  /** Verifies the creator's wallet transaction and the exact on-chain fee event. */
  async releaseOnchain(params: {
    transactionHash: Hash;
    projectOnchainId: string;
    milestoneId: string;
  }): Promise<{ creatorAmount: bigint; feeAmount: bigint }> {
    const event = (await this.eventArgs(
      params.transactionHash,
      'MilestoneReleased',
    )) as {
      campaignId?: bigint;
      milestoneId?: bigint;
      creatorAmount?: bigint;
      feeAmount?: bigint;
    };
    if (
      event.campaignId !==
        this.uint(params.projectOnchainId, 'projectOnchainId') ||
      event.milestoneId !== this.uint(params.milestoneId, 'milestoneId') ||
      event.creatorAmount === undefined ||
      event.feeAmount === undefined
    ) {
      throw new ConflictException(
        'Receipt does not prove the requested milestone release',
      );
    }
    return { creatorAmount: event.creatorAmount, feeAmount: event.feeAmount };
  }

  async prepareRefund(
    projectOnchainId: string,
  ): Promise<{ to: Address; data: Hex }> {
    const { config } = await this.readyClient();
    return {
      to: config.escrow,
      data: encodeFunctionData({
        abi: KEIBO_CAMPAIGN_ESCROW_ABI,
        functionName: 'refund',
        args: [this.uint(projectOnchainId, 'projectOnchainId')],
      }),
    };
  }

  async refundOnchain(params: {
    transactionHash: Hash;
    projectOnchainId: string;
    to: Address;
  }): Promise<bigint> {
    const event = (await this.eventArgs(
      params.transactionHash,
      'Refunded',
    )) as { campaignId?: bigint; contributor?: Address; amount?: bigint };
    if (
      event.campaignId !==
        this.uint(params.projectOnchainId, 'projectOnchainId') ||
      event.contributor?.toLowerCase() !== params.to.toLowerCase() ||
      event.amount === undefined
    ) {
      throw new ConflictException(
        'Receipt does not prove the requested contributor refund',
      );
    }
    return event.amount;
  }

  private async eventArgs(
    hash: Hash,
    expectedEvent: 'Contributed' | 'MilestoneReleased' | 'Refunded',
  ): Promise<unknown> {
    if (!isHash(hash)) throw new ConflictException('Invalid transaction hash');
    const { client, config } = await this.readyClient();
    try {
      const [receipt, transaction] = await Promise.all([
        client.waitForTransactionReceipt({ hash }),
        client.getTransaction({ hash }),
      ]);
      if (
        receipt.status !== 'success' ||
        transaction.to?.toLowerCase() !== config.escrow.toLowerCase()
      ) {
        throw new ConflictException(
          'Transaction did not succeed against KEIBO escrow',
        );
      }
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== config.escrow.toLowerCase()) continue;
        try {
          const decoded = decodeEventLog({
            abi: KEIBO_CAMPAIGN_ESCROW_ABI,
            data: log.data,
            topics: log.topics,
          });
          if (decoded.eventName === expectedEvent) return decoded.args;
        } catch {
          /* unrelated receipt log */
        }
      }
      throw new ConflictException(
        `Missing ${expectedEvent} evidence in transaction receipt`,
      );
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      throw this.rpcFailure(`verify ${expectedEvent} transaction`, error);
    }
  }

  private async readyClient() {
    const config = this.keiboConfig.getRequired();
    const client = createPublicClient({ transport: http(config.rpcUrl) });
    try {
      const [chainId, bytecode] = await Promise.all([
        client.getChainId(),
        client.getCode({ address: config.escrow }),
      ]);
      if (chainId !== config.chainId)
        throw new ServiceUnavailableException(
          'RPC chain ID does not match CHAIN_ID',
        );
      if (!bytecode || bytecode === '0x')
        throw new ServiceUnavailableException(
          'KEIBO escrow address has no deployed bytecode',
        );
      return { client, config };
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw this.rpcFailure('validate KEIBO escrow runtime', error);
    }
  }

  private async successfulReceipt(
    client: ReturnType<typeof createPublicClient>,
    hash: Hash,
    operation: string,
  ): Promise<void> {
    try {
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success')
        throw new ConflictException(
          `KEIBO escrow ${operation} transaction reverted`,
        );
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      throw this.rpcFailure(operation, error);
    }
  }

  private uint(value: string, field: string): bigint {
    if (!/^(0|[1-9][0-9]*)$/.test(value))
      throw new ConflictException(`${field} must be an unsigned integer`);
    return BigInt(value);
  }

  private rpcFailure(
    operation: string,
    error: unknown,
  ): ServiceUnavailableException {
    return new ServiceUnavailableException(
      `Unable to ${operation}: ${error instanceof Error ? error.message : 'unknown RPC failure'}`,
    );
  }
}
