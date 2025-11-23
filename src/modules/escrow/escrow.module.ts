import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EscrowController } from './escrow.controller';
import { EscrowService } from './escrow.service';
import {
  Deposit,
  DepositSchema,
  Escrow,
  EscrowEventLog,
  EscrowEventLogSchema,
  EscrowSchema,
  MilestoneLock,
  MilestoneLockSchema,
} from './schemas/escrow.schema';
import { EscrowRepository } from './escrow.repository';
import { EscrowWeb3Service } from './escrow.web3';
import { RolesGuard } from '../../common/guards/roles.guard';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Escrow.name, schema: EscrowSchema },
      { name: Deposit.name, schema: DepositSchema },
      { name: EscrowEventLog.name, schema: EscrowEventLogSchema },
      { name: MilestoneLock.name, schema: MilestoneLockSchema },
    ]),
  ],
  controllers: [EscrowController],
  providers: [EscrowService, EscrowRepository, EscrowWeb3Service, RolesGuard],
  exports: [EscrowService],
})
export class EscrowModule {}
