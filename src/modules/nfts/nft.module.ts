import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { NftController } from './nft.controller';
import { NftService } from './nft.service';
import { Nft, NftSchema } from './schemas/nft.schema';
import { ViemNftClient } from './helpers/viem-nft-client';
import { RolesGuard } from '../../common/guards/roles.guard';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Nft.name, schema: NftSchema }]),
  ],
  controllers: [NftController],
  providers: [NftService, ViemNftClient, RolesGuard],
  exports: [NftService],
})
export class NftModule {}
