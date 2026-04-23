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
  Query,
  UseGuards,
} from '@nestjs/common';
import { InvestmentsService } from '../services/investments.service';
import { CreateInvestmentDto } from '../dto/create-investment.dto';
import { UpdateInvestmentStatusDto } from '../dto/update-investment-status.dto';
import { FilterInvestmentsDto } from '../dto/filter-investments.dto';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { UserRole } from '../../../common/enums/role.enum';
import { Permission } from '../../../common/enums/permission.enum';
import { Permissions } from '../../../common/decorators/permissions.decorator';
import { RoleMetadataOr } from '../../../common/decorators/role-or.decorator';
import type { JwtPayload } from '../../../common/interfaces/user.interface';

// NOTE: NFT endpoints (/nfts/:address, /nft/:tokenId, /project/:id/nfts) are
// preserved in the `blockchain/nfts-future` branch and will be restored when
// custodial wallets + smart contracts are live.

@Controller('investments')
@UseGuards(RolesGuard)
export class InvestmentsController {
  constructor(private readonly investmentsService: InvestmentsService) { }

  @Post('invest')
  @HttpCode(HttpStatus.CREATED)
  @Roles(UserRole.INVESTOR)
  async invest(
    @CurrentUser() currentUser: JwtPayload,
    @Body() dto: CreateInvestmentDto,
  ) {
    throw new BadRequestException(
      'Direct investment creation is disabled. Use the DPO checkout flow.',
    );
  }

  @Get('user/:userId')
  @Roles(UserRole.INVESTOR, UserRole.ADMIN, UserRole.SUPERADMIN, UserRole.INNOVATOR)
  async getUserInvestments(
    @Param('userId') userId: string,
    @CurrentUser() currentUser: JwtPayload,
  ) {
    return this.investmentsService.getInvestmentsByUser(userId, currentUser);
  }

  @Get('my')
  @Roles(UserRole.INVESTOR, UserRole.ADMIN, UserRole.SUPERADMIN, UserRole.INNOVATOR)
  async getMyInvestments(@CurrentUser() currentUser: JwtPayload) {
    return this.investmentsService.getMyInvestments(currentUser);
  }

  @Get('project/:projectId')
  @Roles(UserRole.ADMIN, UserRole.INNOVATOR)
  async getProjectInvestors(
    @Param('projectId') projectId: string,
    @CurrentUser() currentUser: JwtPayload,
  ) {
    return this.investmentsService.getInvestmentsByProject(projectId, currentUser);
  }

  @Get('repair-prod-db')
  @RoleMetadataOr(UserRole.ADMIN)
  @Permissions(Permission.MANAGE_PROJECTS)
  async repairProdDb() {
    return this.investmentsService.repairDatabase();
  }

  /**
   * Batch retry: scan all investments with mintStatus=FAILED or PENDING
   * (that have a walletAddress) and attempt NFT minting for each.
   * Idempotent — already-MINTED are skipped. ADMIN-only.
   */
  @Post('admin/retry-nft-mints')
  @RoleMetadataOr(UserRole.ADMIN)
  @Permissions(Permission.APPROVE_PROJECTS)
  async retryAllFailedNftMints() {
    return this.investmentsService.retryAllFailedNftMints();
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

  /**
   * Single-investment NFT mint retry. ADMIN-only. Idempotent.
   * Use when: investor connects wallet after payment, or after provisioning repair.
   */
  @Post(':id/retry-nft-mint')
  @RoleMetadataOr(UserRole.ADMIN)
  @Permissions(Permission.APPROVE_PROJECTS)
  async retryNftMint(@Param('id') id: string) {
    return this.investmentsService.retryFailedNftMint(id);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN, UserRole.INVESTOR, UserRole.INNOVATOR)
  async getInvestment(
    @Param('id') id: string,
    @CurrentUser() currentUser: JwtPayload,
  ) {
    return this.investmentsService.getInvestmentById(id, currentUser);
  }
}
