import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule } from '@nestjs/config';
import { MarketplaceController } from './marketplace.controller';
import { MarketplaceService } from './marketplace.service';
import {
    MarketplaceListing,
    MarketplaceListingSchema,
} from './schemas/marketplace-listing.schema';
import { ProjectsModule } from '../projects/projects.module';
import { Investment, InvestmentSchema } from '../investments/schemas/investment.schema';
import { RolesGuard } from '../../common/guards/roles.guard';

@Module({
    imports: [
        ConfigModule,
        MongooseModule.forFeature([
            { name: MarketplaceListing.name, schema: MarketplaceListingSchema },
            { name: Investment.name, schema: InvestmentSchema },
        ]),
        ProjectsModule,
    ],
    controllers: [MarketplaceController],
    providers: [MarketplaceService, RolesGuard],
    exports: [MarketplaceService],
})
export class MarketplaceModule { }
