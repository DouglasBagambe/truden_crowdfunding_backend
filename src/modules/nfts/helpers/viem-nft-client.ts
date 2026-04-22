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

/**
 * ABI subset matching InvestmentNFT.sol (ERC-1155)
 *
 * Key functions:
 *  - createProjectNFT  → called once when a project is created on-chain
 *  - mintInvestmentTokens → called after successful fiat payment; mints
 *    proportional ERC-1155 tokens to the investor's self-custodial wallet
 *  - createListing / purchase / cancelListing → marketplace
 */
export const INVESTMENT_NFT_ABI = [
  // ── Write functions ──────────────────────────────────────────────────────────
  {
    type: 'function',
    name: 'createProjectNFT',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_id', type: 'uint256' },
      { name: '_creator', type: 'address' },
      { name: '_target', type: 'uint256' },
      { name: '_token', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'mintInvestmentTokens',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_projectId', type: 'uint256' },
      { name: '_investor', type: 'address' },
      { name: '_amount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'setProjectMetadata',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_id', type: 'uint256' },
      { name: '_title', type: 'string' },
      { name: '_desc', type: 'string' },
      { name: '_uri', type: 'string' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'createListing',
    stateMutability: 'nonpayable',
    inputs: [
      { name: '_projectId', type: 'uint256' },
      { name: '_amount', type: 'uint256' },
      { name: '_price', type: 'uint256' },
      { name: '_token', type: 'address' },
      { name: '_expiry', type: 'uint256' },
      { name: '_partialFill', type: 'bool' },
      { name: '_minPurchase', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'cancelListing',
    stateMutability: 'nonpayable',
    inputs: [{ name: '_listingId', type: 'uint256' }],
    outputs: [],
  },
  // ── Read functions ───────────────────────────────────────────────────────────
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [
      { name: 'account', type: 'address' },
      { name: 'id', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'totalSupply',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getProject',
    stateMutability: 'view',
    inputs: [{ name: '_id', type: 'uint256' }],
    outputs: [
      { name: 'creator', type: 'address' },
      { name: 'target', type: 'uint256' },
      { name: 'currentValue', type: 'uint256' },
      { name: 'status', type: 'uint8' },
      { name: 'redeemable', type: 'bool' },
    ],
  },
  {
    type: 'function',
    name: 'getInvestment',
    stateMutability: 'view',
    inputs: [
      { name: '_projectId', type: 'uint256' },
      { name: '_user', type: 'address' },
    ],
    outputs: [
      { name: 'originalAmount', type: 'uint256' },
      { name: 'tokens', type: 'uint256' },
      { name: 'currentValue', type: 'uint256' },
      { name: 'totalDividends', type: 'uint256' },
      { name: 'avgPrice', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'getListing',
    stateMutability: 'view',
    inputs: [{ name: '_id', type: 'uint256' }],
    outputs: [
      { name: 'seller', type: 'address' },
      { name: 'tokenId', type: 'uint256' },
      { name: 'amount', type: 'uint256' },
      { name: 'price', type: 'uint256' },
      { name: 'active', type: 'bool' },
    ],
  },
  {
    type: 'function',
    name: 'listingCounter',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'uri',
    stateMutability: 'view',
    inputs: [{ name: '_tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'string' }],
  },
  // ── Events ───────────────────────────────────────────────────────────────────
  {
    type: 'event',
    name: 'TokensMinted',
    inputs: [
      { name: 'projectId', type: 'uint256', indexed: true },
      { name: 'investor', type: 'address', indexed: false },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'ProjectCreated',
    inputs: [
      { name: 'projectId', type: 'uint256', indexed: true },
      { name: 'creator', type: 'address', indexed: false },
      { name: 'supply', type: 'uint256', indexed: false },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'ListingCreated',
    inputs: [
      { name: 'listingId', type: 'uint256', indexed: true },
      { name: 'projectId', type: 'uint256', indexed: false },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'TokensPurchased',
    inputs: [
      { name: 'listingId', type: 'uint256', indexed: true },
      { name: 'buyer', type: 'address', indexed: false },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
    anonymous: false,
  },
] as const satisfies Abi;

type Hex = `0x${string}`;

@Injectable()
export class ViemNftClient {
  private readonly publicClient;
  private readonly walletClient;
  readonly nftAddress: Address;
  readonly chainId: number;
  readonly rpcUrl: string;

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
      name: 'BaseSepolia',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: {
        default: { http: [blockchain.rpcUrl] },
        public: { http: [blockchain.rpcUrl] },
      },
    };

    const rawKey = blockchain.adminPrivateKey.trim();
    const normalizedKey = (rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as Hex;
    const account = privateKeyToAccount(normalizedKey);
    this.chainId = blockchain.chainId;
    this.rpcUrl = blockchain.rpcUrl;

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

  getDiagnostics() {
    return {
      chainId: this.chainId,
      rpcUrl: this.rpcUrl,
      nftAddress: this.nftAddress,
    };
  }

  /** Create project NFT type on-chain (called when a project is approved) */
  async createProjectNFT(params: {
    projectOnchainId: bigint;
    creator: Address;
    targetAmountWei: bigint;
    paymentToken: Address;
  }): Promise<{ hash: Hash; receipt: TransactionReceipt }> {
    const hash: Hash = await this.walletClient.writeContract({
      address: this.nftAddress,
      abi: INVESTMENT_NFT_ABI,
      functionName: 'createProjectNFT',
      args: [
        params.projectOnchainId,
        params.creator,
        params.targetAmountWei,
        params.paymentToken,
      ],
    });
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    return { hash, receipt };
  }

  /** Mint investment tokens to investor's self-custodial wallet */
  async mintInvestmentTokens(params: {
    projectOnchainId: bigint;
    investorWallet: Address;
    amountWei: bigint;
  }): Promise<{ hash: Hash; receipt: TransactionReceipt }> {
    const hash: Hash = await this.walletClient.writeContract({
      address: this.nftAddress,
      abi: INVESTMENT_NFT_ABI,
      functionName: 'mintInvestmentTokens',
      args: [params.projectOnchainId, params.investorWallet, params.amountWei],
    });
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    return { hash, receipt };
  }

  /** Read the ERC-1155 token balance for a user on a specific project */
  async getBalance(walletAddress: Address, projectOnchainId: bigint): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.nftAddress,
      abi: INVESTMENT_NFT_ABI,
      functionName: 'balanceOf',
      args: [walletAddress, projectOnchainId],
    }) as Promise<bigint>;
  }

  /** Read total supply minted for a project token */
  async getTotalSupply(projectOnchainId: bigint): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.nftAddress,
      abi: INVESTMENT_NFT_ABI,
      functionName: 'totalSupply',
      args: [projectOnchainId],
    }) as Promise<bigint>;
  }

  /** Read a specific listing from the contract */
  async getListing(listingId: bigint): Promise<{
    seller: Address;
    tokenId: bigint;
    amount: bigint;
    price: bigint;
    active: boolean;
  }> {
    const result = await this.publicClient.readContract({
      address: this.nftAddress,
      abi: INVESTMENT_NFT_ABI,
      functionName: 'getListing',
      args: [listingId],
    }) as readonly [Address, bigint, bigint, bigint, boolean];
    return {
      seller: result[0],
      tokenId: result[1],
      amount: result[2],
      price: result[3],
      active: result[4],
    };
  }

  /** Read the total number of listings ever created */
  async getListingCounter(): Promise<bigint> {
    return this.publicClient.readContract({
      address: this.nftAddress,
      abi: INVESTMENT_NFT_ABI,
      functionName: 'listingCounter',
      args: [],
    }) as Promise<bigint>;
  }

  getAbi(): Abi {
    return INVESTMENT_NFT_ABI;
  }

  getPublicClient() {
    return this.publicClient;
  }
}
