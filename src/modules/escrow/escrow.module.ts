import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EscrowController } from './controllers/escrow.controller';
import { EscrowService } from './services/escrow.service';
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
import { RolesGuard } from '../../common/guards/roles.guard';
import { ProjectsModule } from '../projects/projects.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Escrow.name, schema: EscrowSchema },
      { name: Deposit.name, schema: DepositSchema },
      { name: EscrowEventLog.name, schema: EscrowEventLogSchema },
      { name: MilestoneLock.name, schema: MilestoneLockSchema },
    ]),
    ProjectsModule,
  ],
  controllers: [EscrowController],
  providers: [EscrowService, EscrowRepository, RolesGuard],
  exports: [EscrowService],
})
export class EscrowModule {}
