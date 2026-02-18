import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ethers } from 'ethers';
import axios from 'axios';

// NFT Contract ABI (add full ABI in production)
const INVESTMENT_NFT_ABI = [
    'function mintInvestmentNFT(address investor, string projectId, uint256 amount, string metadataURI, string investmentId) returns (uint256)',
    'function updateInvestmentValue(uint256 tokenId, uint256 newValue)',
    'function batchUpdateValues(uint256[] tokenIds, uint256[] newValues)',
    'function getInvestmentData(uint256 tokenId) view returns (tuple(string projectId, address investor, uint256 initialAmount, uint256 currentValue, uint256 investmentDate, bool isActive, string investmentId))',
    'function getInvestorNFTs(address investor) view returns (uint256[])',
    'function getProjectNFTs(string projectId) view returns (uint256[])',
    'function getTokenIdByInvestmentId(string investmentId) view returns (uint256)',
    'function getInvestmentMetrics(uint256 tokenId) view returns (uint256 initialAmount, uint256 currentValue, int256 profitLoss, uint256 roiPercentage)',
    'event NFTMinted(uint256 indexed tokenId, string projectId, address indexed investor, uint256 amount, string investmentId)',
    'event ValueUpdated(uint256 indexed tokenId, uint256 oldValue, uint256 newValue, uint256 timestamp)'
];

interface NFTMetadata {
    name: string;
    description: string;
    image: string;
    external_url?: string;
    attributes: Array<{
        trait_type: string;
        value: string | number;
        display_type?: string;
    }>;
}

export interface MintNFTResult {
    tokenId: number;
    txHash: string;
    metadataURI: string;
    contractAddress: string;
}

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
    ) {
        this.initializeContract();
    }

    private initializeContract() {
        try {
            const rpcUrl = this.configService.get<string>('BLOCKCHAIN_RPC_URL');
            const privateKey = this.configService.get<string>('NFT_MINTER_PRIVATE_KEY');
            const contractAddress = this.configService.get<string>('INVESTMENT_NFT_CONTRACT');

            if (!rpcUrl || !privateKey || !contractAddress) {
                this.logger.warn('NFT contract configuration incomplete. NFT features will be disabled.');
                return;
            }

            this.contractAddress = contractAddress;
            this.provider = new ethers.JsonRpcProvider(rpcUrl);
            this.wallet = new ethers.Wallet(privateKey, this.provider);
            this.contract = new ethers.Contract(
                contractAddress,
                INVESTMENT_NFT_ABI,
                this.wallet
            );

            this.logger.log(`NFT contract initialized at ${contractAddress}`);
        } catch (error) {
            this.logger.error('Failed to initialize NFT contract', error);
        }
    }

    /**
     * Mint a new investment NFT
     */
    async mintInvestmentNFT(
        investorAddress: string,
        projectId: string,
        investmentId: string,
        amount: number,
        projectData: {
            name: string;
            category: string;
            imageUrl?: string;
        }
    ): Promise<MintNFTResult> {
        try {
            if (!this.contract) {
                throw new Error('NFT contract not initialized');
            }

            this.logger.log(`Minting NFT for investment ${investmentId}`);

            // Generate metadata
            const metadata = this.generateMetadata(
                projectId,
                projectData.name,
                projectData.category,
                amount,
                investorAddress,
                projectData.imageUrl
            );

            // Upload metadata to IPFS
            const metadataURI = await this.uploadToIPFS(metadata);

            // Mint NFT on-chain (ethers v6 syntax)
            const amountWei = ethers.parseEther(amount.toString());

            const tx = await this.contract.mintInvestmentNFT(
                investorAddress,
                projectId,
                amountWei,
                metadataURI,
                investmentId
            );

            this.logger.log(`NFT mint transaction sent: ${tx.hash}`);

            const receipt = await tx.wait();

            // Extract tokenId from event
            const event = receipt.logs?.find((log: any) => {
                try {
                    const parsed = this.contract!.interface.parseLog(log);
                    return parsed?.name === 'NFTMinted';
                } catch {
                    return false;
                }
            });

            let tokenId: number;
            if (event) {
                const parsed = this.contract.interface.parseLog(event);
                tokenId = Number(parsed?.args?.tokenId);
            } else {
                throw new Error('Failed to extract tokenId from transaction');
            }

            this.logger.log(`NFT minted successfully. TokenId: ${tokenId}`);

            return {
                tokenId,
                txHash: receipt.hash,
                metadataURI,
                contractAddress: this.contractAddress!
            };
        } catch (error) {
            this.logger.error('Failed to mint NFT', error);
            throw error;
        }
    }

    /**
     * Update NFT value when project valuation changes
     */
    async updateNFTValue(tokenId: number, newValue: number): Promise<string> {
        try {
            if (!this.contract) {
                throw new Error('NFT contract not initialized');
            }

            const newValueWei = ethers.parseEther(newValue.toString());

            const tx = await this.contract.updateInvestmentValue(tokenId, newValueWei);
            const receipt = await tx.wait();

            this.logger.log(`NFT ${tokenId} value updated to ${newValue}. Tx: ${receipt.hash}`);

            return receipt.hash;
        } catch (error) {
            this.logger.error(`Failed to update NFT ${tokenId} value`, error);
            throw error;
        }
    }

    /**
     * Batch update NFT values for a project (gas efficient)
     */
    async batchUpdateProjectNFTValues(
        projectId: string,
        newProjectValue: number
    ): Promise<string | null> {
        try {
            if (!this.contract) {
                throw new Error('NFT contract not initialized');
            }

            // Get all NFTs for this project
            const tokenIds = await this.contract.getProjectNFTs(projectId);

            if (tokenIds.length === 0) {
                this.logger.warn(`No NFTs found for project ${projectId}`);
                return null;
            }

            // Calculate new value for each NFT proportionally
            const newValues: bigint[] = [];
            for (const tokenId of tokenIds) {
                const data = await this.contract.getInvestmentData(tokenId);
                const initialAmount = ethers.formatEther(data.initialAmount);
                const proportion = parseFloat(initialAmount) / newProjectValue;
                const newValue = newProjectValue * proportion;
                newValues.push(ethers.parseEther(newValue.toString()));
            }

            // Batch update
            const tx = await this.contract.batchUpdateValues(tokenIds, newValues);
            const receipt = await tx.wait();

            this.logger.log(`Batch updated ${tokenIds.length} NFTs for project ${projectId}`);

            return receipt.hash;
        } catch (error) {
            this.logger.error(`Failed to batch update NFTs for project ${projectId}`, error);
            throw error;
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

            const [data, metrics] = await Promise.all([
                this.contract.getInvestmentData(tokenId),
                this.contract.getInvestmentMetrics(tokenId)
            ]);

            return {
                tokenId,
                projectId: data.projectId,
                investor: data.investor,
                initialAmount: ethers.formatEther(data.initialAmount),
                currentValue: ethers.formatEther(data.currentValue),
                investmentDate: new Date(Number(data.investmentDate) * 1000),
                isActive: data.isActive,
                investmentId: data.investmentId,
                profitLoss: ethers.formatEther(metrics.profitLoss),
                roiPercentage: Number(metrics.roiPercentage)
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

            const tokenIds = await this.contract.getInvestorNFTs(investorAddress);
            return tokenIds.map((id: bigint) => Number(id));
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

            const tokenIds = await this.contract.getProjectNFTs(projectId);
            return tokenIds.map((id: bigint) => Number(id));
        } catch (error) {
            this.logger.error(`Failed to get NFTs for project ${projectId}`, error);
            throw error;
        }
    }

    /**
     * Get token ID from investment ID
     */
    async getTokenIdByInvestmentId(investmentId: string): Promise<number> {
        try {
            if (!this.contract) {
                throw new Error('NFT contract not initialized');
            }

            const tokenId = await this.contract.getTokenIdByInvestmentId(investmentId);
            return Number(tokenId);
        } catch (error) {
            this.logger.error(`Failed to get tokenId for investment ${investmentId}`, error);
            throw error;
        }
    }

    /**
     * Generate NFT metadata
     */
    private generateMetadata(
        projectId: string,
        projectName: string,
        category: string,
        amount: number,
        investor: string,
        imageUrl?: string
    ): NFTMetadata {
        return {
            name: `Investment in ${projectName}`,
            description: `This NFT represents an investment of ${amount} UGX in ${projectName}. The value of this NFT reflects the current value of the investment and can be traded to transfer ownership.`,
            image: imageUrl || `https://truden.io/api/nft-images/${projectId}.png`,
            external_url: `https://truden.io/projects/${projectId}`,
            attributes: [
                {
                    trait_type: 'Project',
                    value: projectName
                },
                {
                    trait_type: 'Category',
                    value: category
                },
                {
                    trait_type: 'Initial Investment',
                    value: amount,
                    display_type: 'number'
                },
                {
                    trait_type: 'Current Value',
                    value: amount,
                    display_type: 'number'
                },
                {
                    trait_type: 'Investment Date',
                    value: new Date().toISOString()
                },
                {
                    trait_type: 'Investor',
                    value: investor
                }
            ]
        };
    }

    /**
     * Upload metadata to IPFS
     */
    private async uploadToIPFS(metadata: NFTMetadata): Promise<string> {
        try {
            // Using Pinata as IPFS provider
            const pinataApiKey = this.configService.get<string>('PINATA_API_KEY');
            const pinataSecretKey = this.configService.get<string>('PINATA_SECRET_KEY');

            if (!pinataApiKey || !pinataSecretKey) {
                // Fallback: return mock IPFS URI for testing
                this.logger.warn('IPFS credentials not configured. Using mock URI.');
                return `ipfs://QmMockHash${Date.now()}`;
            }

            const response = await axios.post(
                'https://api.pinata.cloud/pinning/pinJSONToIPFS',
                metadata,
                {
                    headers: {
                        'pinata_api_key': pinataApiKey,
                        'pinata_secret_api_key': pinataSecretKey
                    }
                }
            );

            const ipfsHash = response.data.IpfsHash;
            return `ipfs://${ipfsHash}`;
        } catch (error) {
            this.logger.error('Failed to upload to IPFS', error);
            // Return mock URI as fallback
            return `ipfs://QmMockHash${Date.now()}`;
        }
    }

    /**
     * Check if NFT contract is initialized
     */
    isInitialized(): boolean {
        return !!this.contract;
    }
}
