import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type Address } from 'viem';
import { ViemNftClient } from '../../nfts/helpers/viem-nft-client';
import { ProjectsService } from '../../projects/projects.service';

export interface MintResult {
    tokenId: number;
    txHash: string;
    tokenAmount: number;
}

@Injectable()
export class InvestmentNFTService {
    private readonly logger = new Logger(InvestmentNFTService.name);

    constructor(
        private readonly configService: ConfigService,
        private readonly projectsService: ProjectsService,
        private readonly viemNftClient: ViemNftClient,
    ) { }

    isInitialized(): boolean {
        // ViemNftClient throws in constructor if not configured — so if it exists, it's ready
        return !!this.viemNftClient;
    }

    // ─── Minting ────────────────────────────────────────────────────────────────

    /**
     * Mint investment tokens to the investor's self-custodial wallet.
     *
     * The contract's mintInvestmentTokens takes:
     *   _projectId  (uint256) — the on-chain project ID
     *   _investor   (address) — the investor's wallet
     *   _amount     (uint256) — the fiat investment amount scaled to wei
     *                           (contract computes token share internally)
     *
     * Falls back to simulated mode when contract isn't configured.
     */
    async mintForUser(
        investorWallet: string,
        projectOnchainId: string,
        investmentAmountUGX: number,
        _investmentId: string,
    ): Promise<MintResult> {
        if (!this.isInitialized()) {
            this.logger.warn('NFT contract not configured — returning simulated mint result');
            return {
                tokenId: Math.floor(Math.random() * 1_000_000),
                txHash: `0x${'0'.repeat(64)}`,
                tokenAmount: 0,
            };
        }

        try {
            // Derive numeric on-chain project ID
            const numericProjectId = /^\d+$/.test(projectOnchainId)
                ? BigInt(projectOnchainId)
                : BigInt('0x' + projectOnchainId.replace(/[^0-9a-f]/gi, '').substring(0, 12) || '0');

            // Scale UGX amount to a comparable wei representation (×1e6 for 6-decimal precision)
            const amountWei = BigInt(Math.floor(investmentAmountUGX * 1e6));

            const { hash, receipt } = await this.viemNftClient.mintInvestmentTokens({
                projectOnchainId: numericProjectId,
                investorWallet: investorWallet as Address,
                amountWei,
            });

            // Derive the token amount minted from logs (or fall back to project id as token type)
            let tokenAmount = 0;
            try {
                const mintLog = receipt.logs.find((l) => l.address.toLowerCase() === this.viemNftClient.nftAddress.toLowerCase());
                if (mintLog && mintLog.data) {
                    // data contains non-indexed fields: investor (address, 32 bytes), amount (uint256, 32 bytes)
                    tokenAmount = Number(BigInt('0x' + mintLog.data.slice(66)));
                }
            } catch {
                // Non-fatal — we just won't have the token amount
            }

            this.logger.log(
                `NFT minted: projectId=${numericProjectId}, txHash=${hash}, to=${investorWallet}`,
            );

            return { tokenId: Number(numericProjectId), txHash: hash, tokenAmount };
        } catch (err: any) {
            this.logger.error(`NFT mint failed: ${err.message}`, err.stack);
            throw err;
        }
    }

    /**
     * Register a project on-chain so NFTs can be minted for it.
     * Called when an admin/backend approves a project for investment.
     */
    async createProjectOnChain(params: {
        projectOnchainId: number;
        creatorWallet: string;
        targetAmountUGX: number;
        paymentToken?: string;
    }): Promise<{ hash: string }> {
        const ETH_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;

        const { hash } = await this.viemNftClient.createProjectNFT({
            projectOnchainId: BigInt(params.projectOnchainId),
            creator: params.creatorWallet as Address,
            // Since payments are fiat, we store the UGX amount scaled (×1e6)
            targetAmountWei: BigInt(Math.floor(params.targetAmountUGX * 1e6)),
            paymentToken: (params.paymentToken as Address) ?? ETH_ADDRESS,
        });

        return { hash };
    }

    // ─── Read ────────────────────────────────────────────────────────────────────

    async getBalance(walletAddress: string, projectOnchainId: number): Promise<number> {
        if (!this.isInitialized()) return 0;
        try {
            const bal = await this.viemNftClient.getBalance(
                walletAddress as Address,
                BigInt(projectOnchainId),
            );
            return Number(bal);
        } catch {
            return 0;
        }
    }
}
