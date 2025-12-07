import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { NftService } from './nft.service';
import { MintNftDto } from './dto/mint-nft.dto';
import { UpdateValuationDto } from './dto/update-valuation.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../../common/enums/role.enum';
import type { JwtPayload } from '../../common/interfaces/user.interface';

@Controller('nfts')
@UseGuards(RolesGuard)
export class NftController {
  constructor(private readonly nftService: NftService) {}

  @Post('mint')
  @HttpCode(HttpStatus.CREATED)
  @Roles(UserRole.ADMIN)
  async mint(
    @Body() dto: MintNftDto,
    @CurrentUser() currentUser: JwtPayload,
  ) {
    return this.nftService.mintNft(dto, currentUser);
  }

  @Get('wallet/:address')
  async getByWallet(@Param('address') address: string) {
    return this.nftService.findByWallet(address);
  }

  @Get('project/:projectId')
  async getByProject(@Param('projectId') projectId: string) {
    return this.nftService.findByProject(projectId);
  }

  @Get(':tokenId')
  async getOne(@Param('tokenId') tokenId: string) {
    const parsed = Number(tokenId);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new BadRequestException('Invalid tokenId');
    }
    return this.nftService.findOneByTokenId(parsed);
  }

  @Patch(':id/value')
  @Roles(UserRole.ADMIN)
  async updateValue(
    @Param('id') id: string,
    @Body() dto: UpdateValuationDto,
    @CurrentUser() currentUser: JwtPayload,
  ) {
    return this.nftService.updateNFTValue(id, dto, currentUser);
  }
}
