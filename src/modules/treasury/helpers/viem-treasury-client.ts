import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createPublicClient,
  http,
  type Abi,
  type Address,
  type Chain,
  type Hash,
  type TransactionReceipt,
} from 'viem';
import { PlatformSignerService } from '../../../common/services/platform-signer.service';

const TREASURY_ABI = [
  {
    type: 'function',
    name: 'adminWithdraw',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'distributeFunds',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'recipients', type: 'address[]' },
      { name: 'amounts', type: 'uint256[]' },
    ],
    outputs: [],
  },
  {
    type: 'event',
    name: 'FeeCaptured',
    inputs: [
      { name: 'payer', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'projectId', type: 'string', indexed: false },
      { name: 'investorId', type: 'string', indexed: false },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'DonationReceived',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'AdminWithdrawal',
    inputs: [
      { name: 'to', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'FundDistributed',
    inputs: [
      { name: 'recipient', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
    anonymous: false,
  },
] as const satisfies Abi;

@Injectable()
export class ViemTreasuryClient {
  private readonly publicClient?: ReturnType<typeof createPublicClient>;
  private readonly treasuryAddress?: Address;

  constructor(
    private readonly configService: ConfigService,
    private readonly signer: PlatformSignerService,
  ) {
    const blockchain = this.configService.get<{
      enabled?: boolean;
      rpcUrl?: string;
      chainId?: number;
      contracts?: { treasury?: string };
    }>('blockchain');

    if (!blockchain?.enabled) return;

    if (!blockchain?.rpcUrl || !blockchain.chainId) {
      throw new BadRequestException('Blockchain RPC configuration is missing');
    }

    if (!blockchain.contracts?.treasury) {
      throw new BadRequestException(
        'Treasury contract address is not configured',
      );
    }

    const chain: Chain = {
      id: blockchain.chainId,
      name: 'CrowdfundingChain',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: {
        default: { http: [blockchain.rpcUrl] },
        public: { http: [blockchain.rpcUrl] },
      },
    };

    this.publicClient = createPublicClient({
      chain,
      transport: http(blockchain.rpcUrl),
    });

    this.treasuryAddress = blockchain.contracts.treasury as Address;
  }

  async adminWithdraw(params: {
    to: string;
    amount: bigint;
  }): Promise<{ hash: Hash; receipt: TransactionReceipt }> {
    const { publicClient, address } = this.requireEnabled();
    const hash = await this.signer.writeContract({
      address,
      abi: TREASURY_ABI,
      functionName: 'adminWithdraw',
      args: [params.to as Address, params.amount],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    return { hash, receipt };
  }

  async distributeFunds(params: {
    recipients: string[];
    amounts: bigint[];
  }): Promise<{ hash: Hash; receipt: TransactionReceipt }> {
    const { publicClient, address } = this.requireEnabled();
    const hash = await this.signer.writeContract({
      address,
      abi: TREASURY_ABI,
      functionName: 'distributeFunds',
      args: [params.recipients as Address[], params.amounts],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });

    return { hash, receipt };
  }

  async getLatestBlockNumber(): Promise<bigint> {
    return this.requireEnabled().publicClient.getBlockNumber();
  }

  async getFeeCapturedLogs(
    fromBlock?: bigint,
    toBlock?: bigint,
  ): Promise<unknown[]> {
    const { publicClient, address } = this.requireEnabled();
    return publicClient.getLogs({
      address,
      event: TREASURY_ABI[2],
      fromBlock,
      toBlock,
    });
  }

  getAbi(): Abi {
    return TREASURY_ABI;
  }

  private requireEnabled() {
    if (!this.publicClient || !this.treasuryAddress) {
      throw new BadRequestException(
        'Blockchain treasury operations are disabled pending production approval',
      );
    }
    return { publicClient: this.publicClient, address: this.treasuryAddress };
  }
}
