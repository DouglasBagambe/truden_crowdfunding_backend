import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Post,
    Query,
    UseGuards,
} from '@nestjs/common';
import { MarketplaceService } from './marketplace.service';
import { CreateListingDto } from './dto/create-listing.dto';
import { RecordPurchaseDto } from './dto/record-purchase.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Public } from '../../common/decorators/public.decorator';
import type { JwtPayload } from '../../common/interfaces/user.interface';

@Controller('marketplace')
@UseGuards(RolesGuard)
export class MarketplaceController {
    constructor(private readonly marketplaceService: MarketplaceService) { }

    /**
     * GET /marketplace/listings
     * Browse active listings. Public endpoint.
     */
    @Get('listings')
    @Public()
    async getListings(
        @Query('projectOnchainId') projectOnchainId?: string,
        @Query('sellerId') sellerId?: string,
        @Query('skip') skip?: string,
        @Query('limit') limit?: string,
    ) {
        return this.marketplaceService.getActiveListings({
            projectOnchainId: projectOnchainId ? Number(projectOnchainId) : undefined,
            sellerId,
            skip: skip ? Number(skip) : 0,
            limit: limit ? Math.min(Number(limit), 50) : 20,
        });
    }

    /**
     * GET /marketplace/listings/mine
     * Get the authenticated user's listings.
     */
    @Get('listings/mine')
    async getMyListings(@CurrentUser() user: JwtPayload) {
        return this.marketplaceService.getMyListings(user);
    }

    /**
     * GET /marketplace/listings/:id
     * Get a single listing by MongoDB ID.
     */
    @Get('listings/:id')
    @Public()
    async getListing(@Param('id') id: string) {
        return this.marketplaceService.getListingById(id);
    }

    /**
     * POST /marketplace/listings
     * Record a listing that the user has already submitted on-chain.
     * The frontend calls createListing() on the contract first, then calls
     * this endpoint with the resulting onchainListingId and txHash.
     */
    @Post('listings')
    async createListing(
        @Body() dto: CreateListingDto,
        @CurrentUser() user: JwtPayload,
    ) {
        return this.marketplaceService.recordListing(dto, user);
    }

    /**
     * DELETE /marketplace/listings/:id
     * Cancel a listing. The frontend must submit cancelListing() on-chain first.
     */
    @Delete('listings/:id')
    async cancelListing(
        @Param('id') id: string,
        @CurrentUser() user: JwtPayload,
    ) {
        return this.marketplaceService.cancelListing(id, user);
    }

    /**
     * POST /marketplace/listings/:id/purchase
     * Record a purchase after the buyer submits the on-chain purchase tx.
     */
    @Post('listings/:id/purchase')
    async recordPurchase(
        @Param('id') id: string,
        @Body() dto: RecordPurchaseDto,
        @CurrentUser() user: JwtPayload,
    ) {
        return this.marketplaceService.recordPurchase(id, dto, user);
    }
}
