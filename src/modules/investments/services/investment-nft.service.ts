import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';
import { ProjectsService } from '../../projects/projects.service';

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

@Injectable()
export class InvestmentNFTService {
    private readonly logger = new Logger(InvestmentNFTService.name);
    private contract: ethers.Contract | null = null;
    private provider: ethers.JsonRpcProvider | null = null;
    private wallet: ethers.Wallet | null = null;
    private contractAddress: string | null = null;

    constructor(
        private readonly configService: ConfigService,
        private readonly projectsService: ProjectsService,
    ) {
        this.initializeContract();
    }

    private initializeContract() {
        try {
            const rpcUrl = this.configService.get<string>('blockchain.rpcUrl');
            const privateKey = this.configService.get<string>('blockchain.adminPrivateKey');
            const contractAddress = this.configService.get<string>('blockchain.contracts.nft');

            if (!rpcUrl || !privateKey || !contractAddress) {
                this.logger.warn('NFT contract configuration incomplete. NFT features will be disabled.');
                return;
            }

            this.contractAddress = contractAddress;
            this.provider = new ethers.JsonRpcProvider(rpcUrl);
            this.wallet = new ethers.Wallet(privateKey, this.provider);
            const abi = [
                'function balanceOf(address account, uint256 id) view returns (uint256)',
                'function totalSupply(uint256 id) view returns (uint256)',
                'function uri(uint256 id) view returns (string)',
            ];
            this.contract = new ethers.Contract(contractAddress, abi, this.wallet);

            this.logger.log(`NFT contract initialized at ${contractAddress}`);
        } catch (error) {
            this.logger.error('Failed to initialize NFT contract', error);
        }
    }

    /**
     * Get NFT data from blockchain
     */
    async getNFTData(tokenId: number): Promise<InvestmentNFTData> {
        try {
            if (!this.contract) {
                throw new Error('NFT contract not initialized');
            }

            const uri = await this.contract.uri(BigInt(tokenId));

            const project = await this.projectsService.findByOnchainId(String(tokenId));
            const now = new Date();

            const raised = (project as any)?.raisedAmount ?? 0;
            const target = (project as any)?.targetAmount ?? 0;
            const currentValue = raised;
            const initialAmount = target;
            const profitLoss = currentValue - initialAmount;
            const roiPercentage = initialAmount > 0 ? (profitLoss / initialAmount) * 100 : 0;

            return {
                tokenId,
                projectId: project ? String((project as any)._id ?? (project as any).id) : String(tokenId),
                investor: '0x0000000000000000000000000000000000000000',
                initialAmount: String(initialAmount),
                currentValue: String(currentValue),
                investmentDate: now,
                isActive: true,
                investmentId: uri,
                profitLoss: String(profitLoss),
                roiPercentage: Number(roiPercentage.toFixed(2)),
            };
        } catch (error) {
            this.logger.error(`Failed to get NFT data for token ${tokenId}`, error);
            throw error;
        }
    }

    /**
     * Get all NFTs owned by an investor
     */
    async getInvestorNFTs(investorAddress: string): Promise<number[]> {
        try {
            if (!this.contract) {
                throw new Error('NFT contract not initialized');
            }

            const roiProjects = await this.projectsService.listRoiProjectsWithOnchainId();

            const checks = await Promise.all(
                roiProjects.map(async (p: any) => {
                    const tokenId = Number(p.projectOnchainId);
                    if (!Number.isFinite(tokenId) || tokenId < 0) return null;
                    const bal = await this.contract!.balanceOf(investorAddress, BigInt(tokenId));
                    const has = typeof bal === 'bigint' ? bal > 0n : BigInt(bal) > 0n;
                    return has ? tokenId : null;
                })
            );

            return checks.filter((x): x is number => typeof x === 'number');
        } catch (error) {
            this.logger.error(`Failed to get NFTs for investor ${investorAddress}`, error);
            throw error;
        }
    }

    /**
     * Get all NFTs for a project
     */
    async getProjectNFTs(projectId: string): Promise<number[]> {
        try {
            if (!this.contract) {
                throw new Error('NFT contract not initialized');
            }

            const project = await this.projectsService.ensureProjectExists(projectId);
            const tokenId = Number((project as any).projectOnchainId);
            if (!Number.isFinite(tokenId) || tokenId < 0) return [];
            const supply = await this.contract.totalSupply(BigInt(tokenId));
            const hasSupply = typeof supply === 'bigint' ? supply > 0n : BigInt(supply) > 0n;
            return hasSupply ? [tokenId] : [];
        } catch (error) {
            this.logger.error(`Failed to get NFTs for project ${projectId}`, error);
            throw error;
        }
    }

    /**
     * Check if NFT contract is initialized
     */
    isInitialized(): boolean {
        return !!this.contract;
    }
}
