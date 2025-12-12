import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { TreasuryService } from './treasury.service';
import { CreateTreasuryTransactionDto } from './dto/create-treasury-transaction.dto';
import { DistributeFundsDto } from './dto/distribute-funds.dto';
import { FilterTreasuryDto } from './dto/filter-treasury.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { JwtPayload } from '../../common/interfaces/user.interface';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../../common/enums/role.enum';

@Controller('treasury')
@UseGuards(RolesGuard)
export class TreasuryController {
  constructor(private readonly treasuryService: TreasuryService) {}

  @Post('record-fee')
  @Roles(UserRole.ADMIN, UserRole.SUPERADMIN, UserRole.TREASURY)
  async recordFee(
    @Body() dto: CreateTreasuryTransactionDto,
    @CurrentUser() currentUser: JwtPayload,
  ) {
    return this.treasuryService.recordFee(dto, currentUser);
  }

  @Post('donations')
  async recordDonation(
    @Body() dto: CreateTreasuryTransactionDto,
    @CurrentUser() currentUser: JwtPayload,
  ) {
    return this.treasuryService.recordDonation(dto, currentUser);
  }

  @Post('withdraw')
  @Roles(UserRole.ADMIN, UserRole.SUPERADMIN, UserRole.TREASURY)
  async withdraw(
    @Body() dto: CreateTreasuryTransactionDto,
    @CurrentUser() currentUser: JwtPayload,
  ) {
    return this.treasuryService.withdraw(dto, currentUser);
  }

  @Post('distribute')
  @Roles(UserRole.ADMIN, UserRole.SUPERADMIN, UserRole.TREASURY)
  async distribute(
    @Body() dto: DistributeFundsDto,
    @CurrentUser() currentUser: JwtPayload,
  ) {
    return this.treasuryService.distributeFunds(dto, currentUser);
  }

  @Get('transactions')
  @Roles(UserRole.ADMIN, UserRole.SUPERADMIN, UserRole.TREASURY)
  async getTransactions(@Query() query: FilterTreasuryDto) {
    return this.treasuryService.getTransactions(query);
  }

  @Get('balance')
  @Roles(UserRole.ADMIN, UserRole.SUPERADMIN, UserRole.TREASURY)
  async getBalance() {
    return this.treasuryService.getBalance();
  }

  @Get('summary')
  @Roles(UserRole.ADMIN, UserRole.SUPERADMIN, UserRole.TREASURY)
  async getSummary() {
    return this.treasuryService.getSummary();
  }
}
