import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { EscrowService } from './escrow.service';
import { DepositDto } from './dto/deposit.dto';
import { ReleaseDto } from './dto/release.dto';
import { RefundDto } from './dto/refund.dto';
import { DisputeDto } from './dto/dispute.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../../common/enums/role.enum';

@Controller('escrow')
@UseGuards(RolesGuard)
export class EscrowController {
  constructor(private readonly escrowService: EscrowService) {}

  @Post('deposit')
  @HttpCode(HttpStatus.CREATED)
  @Roles(UserRole.INVESTOR)
  async createDeposit(
    @CurrentUser('sub') userId: string,
    @Body() dto: DepositDto,
  ) {
    return this.escrowService.createDeposit(dto, userId);
  }

  @Get(':projectId')
  @Roles(UserRole.ADMIN, UserRole.INVESTOR, UserRole.INNOVATOR)
  async getEscrow(@Param('projectId') projectId: string) {
    return this.escrowService.getEscrow(projectId);
  }

  @Post('release')
  @Roles(UserRole.ADMIN, UserRole.INNOVATOR)
  async requestRelease(
    @CurrentUser('sub') userId: string,
    @Body() dto: ReleaseDto,
  ) {
    return this.escrowService.requestRelease(dto, userId);
  }

  @Post('dispute')
  @Roles(UserRole.INVESTOR, UserRole.ADMIN)
  async raiseDispute(
    @CurrentUser('sub') userId: string,
    @Body() dto: DisputeDto,
  ) {
    return this.escrowService.raiseDispute(dto, userId);
  }

  @Post('refund')
  @Roles(UserRole.ADMIN)
  async refundDeposit(
    @CurrentUser('sub') userId: string,
    @Body() dto: RefundDto,
  ) {
    return this.escrowService.refundDeposit(dto, userId);
  }

  @Get('events/:txHash')
  @Roles(UserRole.ADMIN)
  async getEvents(@Param('txHash') txHash: string) {
    return this.escrowService.getEventsByTxHash(txHash);
  }
}
