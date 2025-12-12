import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createPublicClient,
  createWalletClient,
  http,
  type Abi,
  type Address,
  type Chain,
  type Hash,
  type TransactionReceipt,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

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

type Hex = `0x${string}`;

@Injectable()
export class ViemTreasuryClient {
  private readonly publicClient;
  private readonly walletClient;
  private readonly treasuryAddress: Address;

  constructor(private readonly configService: ConfigService) {
    const blockchain = this.configService.get<{
      rpcUrl?: string;
      chainId?: number;
      contracts?: { treasury?: string };
      adminPrivateKey?: string;
    }>('blockchain');

    if (!blockchain?.rpcUrl || !blockchain.chainId) {
      throw new BadRequestException('Blockchain RPC configuration is missing');
    }

    if (!blockchain.adminPrivateKey) {
      throw new BadRequestException(
        'Blockchain admin private key is not configured',
      );
    }

    if (!blockchain.contracts?.treasury) {
      throw new BadRequestException('Treasury contract address is not configured');
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

    const rawKey = blockchain.adminPrivateKey.trim();
    const normalizedKey = (rawKey.startsWith('0x')
      ? rawKey
      : `0x${rawKey}`) as Hex;

    const account = privateKeyToAccount(normalizedKey);

    this.publicClient = createPublicClient({
      chain,
      transport: http(blockchain.rpcUrl),
    });

    this.walletClient = createWalletClient({
      chain,
      transport: http(blockchain.rpcUrl),
      account,
    });

    this.treasuryAddress = blockchain.contracts.treasury as Address;
  }

  async adminWithdraw(params: {
    to: string;
    amount: bigint;
  }): Promise<{ hash: Hash; receipt: TransactionReceipt }> {
    const hash: Hash = await this.walletClient.writeContract({
      address: this.treasuryAddress,
      abi: TREASURY_ABI,
      functionName: 'adminWithdraw',
      args: [params.to as Address, params.amount],
    });

    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });

    return { hash, receipt };
  }

  async distributeFunds(params: {
    recipients: string[];
    amounts: bigint[];
  }): Promise<{ hash: Hash; receipt: TransactionReceipt }> {
    const hash: Hash = await this.walletClient.writeContract({
      address: this.treasuryAddress,
      abi: TREASURY_ABI,
      functionName: 'distributeFunds',
      args: [params.recipients as Address[], params.amounts],
    });

    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });

    return { hash, receipt };
  }

  async getLatestBlockNumber(): Promise<bigint> {
    return this.publicClient.getBlockNumber();
  }

  async getFeeCapturedLogs(fromBlock?: bigint, toBlock?: bigint): Promise<any[]> {
    const logs = await (this.publicClient as any).getLogs({
      address: this.treasuryAddress,
      events: [{ abi: TREASURY_ABI, eventName: 'FeeCaptured' }],
      fromBlock,
      toBlock,
    });
    return logs as any[];
  }

  getAbi(): Abi {
    return TREASURY_ABI;
  }
}
