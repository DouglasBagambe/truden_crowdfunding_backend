import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
    createWalletClient,
    createPublicClient,
    http,
    type Abi,
    type Address,
    type Chain,
    type Hash,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { ProjectsService } from '../../projects/projects.service';

type Hex = `0x${string}`;

// Minimal ABI for InvestmentNFT ERC-1155 contract
const INVESTMENT_NFT_ABI = [
    {
        type: 'function',
        name: 'mintInvestmentTokens',
        stateMutability: 'nonpayable',
        inputs: [
            { name: 'to', type: 'address' },
            { name: 'projectOnchainId', type: 'uint256' },
            { name: 'amount', type: 'uint256' },
            { name: 'investmentId', type: 'string' },
        ],
        outputs: [{ name: 'tokenId', type: 'uint256' }],
    },
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
        name: 'uri',
        stateMutability: 'view',
        inputs: [{ name: 'id', type: 'uint256' }],
        outputs: [{ name: '', type: 'string' }],
    },
] as const satisfies Abi;

export interface InvestmentNFTData {
    tokenId: number;
    projectId: string;
    investor: string;
    initialAmount: string;
    currentValue: string;
    investmentDate: Date;
    isActive: boolean;
    investmentId: string;
    profitLoss: string;
    roiPercentage: number;
}

export interface MintResult {
    tokenId: number;
    txHash: string;
}

@Injectable()
export class InvestmentNFTService {
    private readonly logger = new Logger(InvestmentNFTService.name);
    private initialized = false;
    private contractAddress: string | null = null;
    private rpcUrl: string | null = null;
    private adminPrivateKey: Hex | null = null;
    private chain: Chain | null = null;

    constructor(
        private readonly configService: ConfigService,
        private readonly projectsService: ProjectsService,
    ) {
        this.initializeConfig();
    }

    private initializeConfig() {
        try {
            const rpcUrl = this.configService.get<string>('blockchain.rpcUrl');
            const privateKey = this.configService.get<string>('blockchain.adminPrivateKey');
            const contractAddress = this.configService.get<string>('blockchain.contracts.nft');
            const chainId = this.configService.get<number>('blockchain.chainId');

            if (!rpcUrl || !privateKey || !contractAddress) {
                this.logger.warn('NFT contract configuration incomplete. NFT minting will be simulated.');
                return;
            }

            this.contractAddress = contractAddress;
            this.rpcUrl = rpcUrl;
            const rawKey = privateKey.trim();
            this.adminPrivateKey = (rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as Hex;
            this.chain = {
                id: chainId ?? 1,
                name: 'CrowdfundingChain',
                nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
                rpcUrls: {
                    default: { http: [rpcUrl] },
                    public: { http: [rpcUrl] },
                },
            };
            this.initialized = true;
            this.logger.log(`NFT contract initialized at ${contractAddress}`);
        } catch (error) {
            this.logger.error('Failed to initialize NFT contract config', error);
        }
    }

    isInitialized(): boolean {
        return this.initialized;
    }

    // ─── Minting ────────────────────────────────────────────────────────────────

    /**
     * Mint investment NFT to the user's custodial wallet address.
     * Uses the platform admin key to sign the transaction.
     * Falls back to simulated mode if contract not configured.
     */
    async mintForUser(
        custodialAddress: string,
        projectOnchainId: string,
        amount: number,
        investmentId: string,
    ): Promise<MintResult> {
        if (!this.initialized || !this.contractAddress || !this.adminPrivateKey || !this.chain) {
            this.logger.warn('NFT contract not configured — returning simulated mint result');
            return {
                tokenId: Math.floor(Math.random() * 1_000_000),
                txHash: `0x${'0'.repeat(64)}`,
            };
        }

        const account = privateKeyToAccount(this.adminPrivateKey);
        const publicClient = createPublicClient({ chain: this.chain, transport: http(this.rpcUrl!) });
        const walletClient = createWalletClient({ chain: this.chain, transport: http(this.rpcUrl!), account });

        // Derive numeric project onchain ID
        const isNumeric = /^\d+$/.test(projectOnchainId);
        const numericProjectId = isNumeric
            ? BigInt(projectOnchainId)
            : BigInt('0x' + projectOnchainId.substring(0, 12));

        const hash: Hash = await walletClient.writeContract({
            address: this.contractAddress as Address,
            abi: INVESTMENT_NFT_ABI,
            functionName: 'mintInvestmentTokens',
            args: [
                custodialAddress as Address,
                numericProjectId,
                BigInt(Math.floor(amount * 1e6)), // amount in micro-units (6 decimals)
                investmentId,
            ],
        });

        await publicClient.waitForTransactionReceipt({ hash });

        // Read the token ID from the blockchain (simplified: use project ID as token type)
        const tokenId = Number(numericProjectId);

        this.logger.log(`NFT minted: tokenId=${tokenId}, txHash=${hash}, to=${custodialAddress}`);

        return { tokenId, txHash: hash };
    }

    // ─── Read methods ────────────────────────────────────────────────────────────

    async getNFTData(tokenId: number): Promise<InvestmentNFTData> {
        try {
            const project = await this.projectsService.findByOnchainId(String(tokenId));
            const now = new Date();
            const raised = (project as any)?.raisedAmount ?? 0;
            const target = (project as any)?.targetAmount ?? 0;
            const profitLoss = raised - target;
            const roiPercentage = target > 0 ? (profitLoss / target) * 100 : 0;

            return {
                tokenId,
                projectId: project ? String((project as any)._id ?? (project as any).id) : String(tokenId),
                investor: '0x0000000000000000000000000000000000000000',
                initialAmount: String(target),
                currentValue: String(raised),
                investmentDate: now,
                isActive: true,
                investmentId: String(tokenId),
                profitLoss: String(profitLoss),
                roiPercentage: Number(roiPercentage.toFixed(2)),
            };
        } catch (error) {
            this.logger.error(`Failed to get NFT data for token ${tokenId}`, error);
            throw error;
        }
    }

    async getInvestorNFTs(investorAddress: string): Promise<number[]> {
        if (!this.initialized || !this.contractAddress || !this.chain) return [];

        try {
            const publicClient = createPublicClient({ chain: this.chain, transport: http(this.rpcUrl!) });
            const roiProjects = await this.projectsService.listRoiProjectsWithOnchainId();

            const checks = await Promise.all(
                roiProjects.map(async (p: any) => {
                    const tokenId = Number(p.projectOnchainId);
                    if (!Number.isFinite(tokenId) || tokenId < 0) return null;
                    const bal = await publicClient.readContract({
                        address: this.contractAddress as Address,
                        abi: INVESTMENT_NFT_ABI,
                        functionName: 'balanceOf',
                        args: [investorAddress as Address, BigInt(tokenId)],
                    });
                    return (bal as bigint) > 0n ? tokenId : null;
                }),
            );

            return checks.filter((x): x is number => typeof x === 'number');
        } catch (error) {
            this.logger.error(`Failed to get NFTs for investor ${investorAddress}`, error);
            return [];
        }
    }

    async getProjectNFTs(projectId: string): Promise<number[]> {
        if (!this.initialized || !this.contractAddress || !this.chain) return [];

        try {
            const publicClient = createPublicClient({ chain: this.chain, transport: http(this.rpcUrl!) });
            const project = await this.projectsService.ensureProjectExists(projectId);
            const tokenId = Number((project as any).projectOnchainId);
            if (!Number.isFinite(tokenId) || tokenId < 0) return [];

            const supply = await publicClient.readContract({
                address: this.contractAddress as Address,
                abi: INVESTMENT_NFT_ABI,
                functionName: 'totalSupply',
                args: [BigInt(tokenId)],
            });
            return (supply as bigint) > 0n ? [tokenId] : [];
        } catch (error) {
            this.logger.error(`Failed to get NFTs for project ${projectId}`, error);
            return [];
        }
    }
}

