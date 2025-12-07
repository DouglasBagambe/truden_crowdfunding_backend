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

const INVESTMENT_NFT_ABI = [
  {
    type: 'function',
    name: 'mintNFT',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'projectId', type: 'string' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'event',
    name: 'Transfer',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'tokenId', type: 'uint256', indexed: true },
    ],
    anonymous: false,
  },
] as const satisfies Abi;

type Hex = `0x${string}`;

@Injectable()
export class ViemNftClient {
  private readonly publicClient;
  private readonly walletClient;
  private readonly nftAddress: Address;

  constructor(private readonly configService: ConfigService) {
    const blockchain = this.configService.get<{
      rpcUrl?: string;
      chainId?: number;
      contracts?: { nft?: string };
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

    if (!blockchain.contracts?.nft) {
      throw new BadRequestException('NFT contract address is not configured');
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

    this.nftAddress = blockchain.contracts.nft as Address;
  }

  async mintInvestmentNft(params: {
    to: Address;
    projectId: string;
    amount: bigint;
  }): Promise<{ hash: Hash; receipt: TransactionReceipt }> {
    const hash: Hash = await this.walletClient.writeContract({
      address: this.nftAddress,
      abi: INVESTMENT_NFT_ABI,
      functionName: 'mintNFT',
      args: [params.to, params.projectId, params.amount],
    });

    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });

    return { hash, receipt };
  }

  getAbi(): Abi {
    return INVESTMENT_NFT_ABI;
  }
}
