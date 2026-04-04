import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
    MarketplaceListing,
    MarketplaceListingDocument,
    ListingStatus,
} from './schemas/marketplace-listing.schema';
import { CreateListingDto } from './dto/create-listing.dto';
import { RecordPurchaseDto } from './dto/record-purchase.dto';
import { ProjectsService } from '../projects/projects.service';
import type { JwtPayload } from '../../common/interfaces/user.interface';
import { InvestmentsService } from '../investments/services/investments.service';
import { InjectModel as InjectModelAlias } from '@nestjs/mongoose';
import { Investment, InvestmentDocument } from '../investments/schemas/investment.schema';
import { InvestmentStatus } from '../investments/interfaces/investment.interface';

@Injectable()
export class MarketplaceService {
    private readonly logger = new Logger(MarketplaceService.name);

    constructor(
        @InjectModel(MarketplaceListing.name)
        private readonly listingModel: Model<MarketplaceListingDocument>,
        @InjectModel(Investment.name)
        private readonly investmentModel: Model<InvestmentDocument>,
        private readonly projectsService: ProjectsService,
    ) { }

    // ── Listings ──────────────────────────────────────────────────────────────

    /**
     * Browse all active listings with optional project filter.
     */
    async getActiveListings(params?: {
        projectOnchainId?: number;
        sellerId?: string;
        skip?: number;
        limit?: number;
    }): Promise<{ items: MarketplaceListingDocument[]; total: number }> {
        const filter: Record<string, unknown> = { status: ListingStatus.Active };
        if (params?.projectOnchainId) filter.projectOnchainId = params.projectOnchainId;
        if (params?.sellerId && Types.ObjectId.isValid(params.sellerId)) {
            filter.sellerId = new Types.ObjectId(params.sellerId);
        }
        const limit = params?.limit ?? 20;
        const skip = params?.skip ?? 0;

        const [items, total] = await Promise.all([
            this.listingModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).exec(),
            this.listingModel.countDocuments(filter).exec(),
        ]);

        return { items, total };
    }

    async getListingById(id: string): Promise<MarketplaceListingDocument> {
        if (!Types.ObjectId.isValid(id)) throw new BadRequestException('Invalid listing id');
        const listing = await this.listingModel.findById(id).exec();
        if (!listing) throw new NotFoundException('Listing not found');
        return listing;
    }

    /**
     * Record a listing that the user has already submitted on-chain.
     * Frontend submits the tx first (via MetaMask), then calls this to
     * persist the listing in the DB for browsing.
     */
    async recordListing(
        dto: CreateListingDto,
        currentUser: JwtPayload,
    ): Promise<MarketplaceListingDocument> {
        if (!currentUser.sub) throw new BadRequestException('Missing user id');

        // Ensure user id is valid
        if (!Types.ObjectId.isValid(currentUser.sub)) {
            throw new BadRequestException('Invalid user id in token');
        }

        // Check for duplicate on-chain listing id
        const existing = await this.listingModel.findOne({ onchainListingId: dto.onchainListingId });
        if (existing) return existing; // idempotent

        // Enrich with project title
        let projectTitle: string | undefined;
        let projectMongoId: Types.ObjectId | undefined;
        try {
            if (dto.projectId && Types.ObjectId.isValid(dto.projectId)) {
                const proj = await this.projectsService.ensureProjectExists(dto.projectId);
                projectTitle = (proj as any).title || (proj as any).name;
                projectMongoId = new Types.ObjectId(dto.projectId);
            }
        } catch {
            // Non-fatal — listing still gets created
        }

        const priceWei = BigInt(Math.round(dto.pricePerTokenEth * 1e18));

        const listing = await this.listingModel.create({
            onchainListingId: dto.onchainListingId,
            projectOnchainId: dto.projectOnchainId,
            projectId: projectMongoId,
            sellerId: new Types.ObjectId(currentUser.sub),
            sellerWallet: dto.sellerWallet.toLowerCase(),
            tokenAmount: dto.tokenAmount,
            pricePerTokenWei: priceWei.toString(),
            pricePerTokenEth: dto.pricePerTokenEth,
            totalValueEth: dto.pricePerTokenEth * dto.tokenAmount,
            paymentToken: dto.paymentToken ?? '0x0000000000000000000000000000000000000000',
            expiryTimestamp: dto.expiryTimestamp,
            partialFill: dto.partialFill ?? true,
            minPurchase: dto.minPurchase ?? 1,
            status: ListingStatus.Active,
            createTxHash: dto.createTxHash,
            projectTitle,
        });

        // Mark investment as listed
        await this.investmentModel.updateMany(
            {
                investorId: new Types.ObjectId(currentUser.sub),
                nftProjectId: dto.projectOnchainId,
                status: InvestmentStatus.Active,
            },
            { listed: true },
        );

        this.logger.log(
            `Listing recorded: id=${listing._id}, onchainId=${dto.onchainListingId}, project=${dto.projectOnchainId}`,
        );

        return listing;
    }

    /**
     * Cancel a listing (seller only). The on-chain cancelListing must be
     * submitted first by the seller; then this endpoint is called to mark
     * the DB record cancelled.
     */
    async cancelListing(listingId: string, currentUser: JwtPayload): Promise<MarketplaceListingDocument> {
        const listing = await this.listingModel.findById(listingId).exec();
        if (!listing) throw new NotFoundException('Listing not found');

        if (listing.sellerId.toString() !== currentUser.sub) {
            throw new ForbiddenException('Only the seller can cancel this listing');
        }

        if (listing.status !== ListingStatus.Active) {
            throw new BadRequestException('Listing is not active');
        }

        listing.status = ListingStatus.Cancelled;
        await listing.save();

        // Unmark investment listed flag
        await this.investmentModel.updateMany(
            {
                investorId: listing.sellerId,
                nftProjectId: listing.projectOnchainId,
                listed: true,
            },
            { listed: false },
        );

        return listing;
    }

    /**
     * Record a purchase after the buyer has submitted the on-chain transaction.
     * Updates listing quantity / status and creates a new investment record for
     * the buyer, while marking the seller's record as completed/sold.
     */
    async recordPurchase(
        listingId: string,
        dto: RecordPurchaseDto,
        currentUser: JwtPayload,
    ): Promise<{ listing: MarketplaceListingDocument }> {
        const listing = await this.listingModel.findById(listingId).exec();
        if (!listing) throw new NotFoundException('Listing not found');
        if (listing.status !== ListingStatus.Active) {
            throw new BadRequestException('Listing is not active');
        }
        if (dto.tokenAmount > listing.tokenAmount) {
            throw new BadRequestException('Purchase amount exceeds available tokens');
        }
        if (listing.sellerId.toString() === currentUser.sub) {
            throw new ForbiddenException('Cannot buy your own listing');
        }

        // Update listing token count
        listing.tokenAmount -= dto.tokenAmount;
        if (listing.tokenAmount === 0 || !listing.partialFill) {
            listing.status = ListingStatus.Sold;
        }
        await listing.save();

        // Create investment record for buyer (migrated from seller's position)
        if (currentUser.sub && Types.ObjectId.isValid(currentUser.sub)) {
            const purchaseValueEth = listing.pricePerTokenEth * dto.tokenAmount;
            const fiatEstimate = listing.originalFiatValue
                ? (listing.originalFiatValue * dto.tokenAmount) / (listing.tokenAmount + dto.tokenAmount)
                : 0;

            await this.investmentModel.create({
                investorId: new Types.ObjectId(currentUser.sub),
                projectId: listing.projectId,
                amount: fiatEstimate,
                currency: 'UGX',
                txHash: dto.purchaseTxHash,
                walletAddress: dto.buyerWallet.toLowerCase(),
                nftProjectId: listing.projectOnchainId,
                nftTokenAmount: dto.tokenAmount,
                nftTxHash: dto.purchaseTxHash,
                nftMinted: true,
                listed: false,
                status: InvestmentStatus.Active,
                notes: `Purchased from marketplace listing ${listing.onchainListingId} for ${purchaseValueEth} ETH`,
            });
        }

        this.logger.log(
            `Purchase recorded: listing=${listingId}, buyer=${dto.buyerWallet}, amount=${dto.tokenAmount}`,
        );

        return { listing };
    }

    /** Get all listings for a specific seller */
    async getMyListings(currentUser: JwtPayload): Promise<MarketplaceListingDocument[]> {
        if (!currentUser.sub) return [];
        return this.listingModel
            .find({ sellerId: new Types.ObjectId(currentUser.sub) })
            .sort({ createdAt: -1 })
            .exec();
    }
}
