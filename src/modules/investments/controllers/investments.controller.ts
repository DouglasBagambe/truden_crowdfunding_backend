import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { InvestmentsService } from '../services/investments.service';
import { InvestmentNFTService, type InvestmentNFTData } from '../services/investment-nft.service';
import { CreateInvestmentDto } from '../dto/create-investment.dto';
import { UpdateInvestmentStatusDto } from '../dto/update-investment-status.dto';
import { FilterInvestmentsDto } from '../dto/filter-investments.dto';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { UserRole } from '../../../common/enums/role.enum';
import type { JwtPayload } from '../../../common/interfaces/user.interface';

@Controller('investments')
@UseGuards(RolesGuard)
export class InvestmentsController {
  constructor(
    private readonly investmentsService: InvestmentsService,
    private readonly investmentNFTService: InvestmentNFTService,
  ) { }

  @Post('invest')
  @HttpCode(HttpStatus.CREATED)
  @Roles(UserRole.INVESTOR)
  async invest(
    @CurrentUser() currentUser: JwtPayload,
    @Body() dto: CreateInvestmentDto,
  ) {
    return this.investmentsService.createInvestment(dto, currentUser);
  }

  @Get('user/:userId')
  @Roles(UserRole.INVESTOR, UserRole.ADMIN, UserRole.INNOVATOR)
  async getUserInvestments(
    @Param('userId') userId: string,
    @CurrentUser() currentUser: JwtPayload,
  ) {
    return this.investmentsService.getInvestmentsByUser(userId, currentUser);
  }

  @Get('my')
  @Roles(UserRole.INVESTOR)
  async getMyInvestments(@CurrentUser() currentUser: JwtPayload) {
    return this.investmentsService.getMyInvestments(currentUser);
  }

  @Get('project/:projectId')
  @Roles(UserRole.ADMIN, UserRole.INNOVATOR)
  async getProjectInvestors(
    @Param('projectId') projectId: string,
    @CurrentUser() currentUser: JwtPayload,
  ) {
    return this.investmentsService.getInvestmentsByProject(
      projectId,
      currentUser,
    );
  }

  @Get()
  @Roles(UserRole.ADMIN)
  async listInvestments(
    @Query() filterDto: FilterInvestmentsDto,
    @CurrentUser() currentUser: JwtPayload,
  ) {
    return this.investmentsService.listInvestments(filterDto, currentUser);
  }

  @Patch(':id/status')
  @Roles(UserRole.ADMIN)
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateInvestmentStatusDto,
    @CurrentUser() currentUser: JwtPayload,
  ) {
    return this.investmentsService.updateStatus(id, dto, currentUser);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.INVESTOR, UserRole.INNOVATOR)
  async getInvestment(
    @Param('id') id: string,
    @CurrentUser() currentUser: JwtPayload,
  ) {
    return this.investmentsService.getInvestmentById(id, currentUser);
  }

  // NFT Endpoints
  @Get('nfts/:investorAddress')
  @Roles(UserRole.INVESTOR, UserRole.ADMIN)
  async getInvestorNFTs(@Param('investorAddress') investorAddress: string) {
    if (!this.investmentNFTService.isInitialized()) {
      return { message: 'NFT system not configured', nfts: [] };
    }
    const tokenIds = await this.investmentNFTService.getInvestorNFTs(investorAddress);
    return { tokenIds, count: tokenIds.length };
  }

  @Get('nft/:tokenId')
  @Roles(UserRole.INVESTOR, UserRole.ADMIN)
  async getNFTData(@Param('tokenId') tokenId: string): Promise<InvestmentNFTData | { message: string }> {
    if (!this.investmentNFTService.isInitialized()) {
      return { message: 'NFT system not configured' };
    }
    return this.investmentNFTService.getNFTData(parseInt(tokenId, 10));
  }

  @Get('project/:projectId/nfts')
  @Roles(UserRole.ADMIN, UserRole.INNOVATOR)
  async getProjectNFTs(@Param('projectId') projectId: string) {
    if (!this.investmentNFTService.isInitialized()) {
      return { message: 'NFT system not configured', nfts: [] };
    }
    const tokenIds = await this.investmentNFTService.getProjectNFTs(projectId);
    return { tokenIds, count: tokenIds.length };
  }
}
