import { BadRequestException, Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import { EscrowRepository } from '../escrow.repository';
import { DepositDto } from '../dto/deposit.dto';
import { ReleaseDto } from '../dto/release.dto';
import { RefundDto } from '../dto/refund.dto';
import { DisputeDto } from '../dto/dispute.dto';
import { DepositStatus } from '../types';
import { EscrowEvents } from '../events';
import { ProjectsService } from '../../projects/projects.service';

@Injectable()
export class EscrowService {
  constructor(
    private readonly escrowRepository: EscrowRepository,
    private readonly projectsService: ProjectsService,
  ) {}

  async createDeposit(dto: DepositDto, investorId: string) {
    if (!Types.ObjectId.isValid(dto.projectId)) {
      throw new BadRequestException('Invalid projectId');
    }

    await this.projectsService.ensureProjectIsOpenForInvestment(dto.projectId);

    const projectObjectId = new Types.ObjectId(dto.projectId);
    const investorObjectId = new Types.ObjectId(investorId);

    const escrow = await this.escrowRepository.findOrCreateEscrow(
      projectObjectId,
      dto.currency,
    );

    const escrowId = escrow._id;

    const amount = Number(dto.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Invalid amount');
    }

    const deposit = await this.escrowRepository.createDeposit({
      escrowId: escrowId,
      projectId: projectObjectId,
      investorId: investorObjectId,
      amount,
      currency: dto.currency,
      source: dto.source,
      txHash: dto.txHash,
      providerTxId: dto.providerTxId,
      metadata: dto.metadata,
    });

    const depositId = deposit._id;

    await this.escrowRepository.attachDepositToEscrow(escrowId, depositId);

    await this.escrowRepository.incrementEscrowLocked(escrowId, amount);

    await this.escrowRepository.createEventLog({
      escrowId: escrowId,
      type: EscrowEvents.DEPOSIT_CREATED,
      payload: {
        depositId: depositId.toHexString(),
        projectId: dto.projectId,
        amount: dto.amount,
        currency: dto.currency,
        source: dto.source,
      },
      txHash: deposit.txHash,
      actor: { id: investorId, role: 'INVESTOR' },
    });

    return {
      success: true,
      depositId: depositId.toHexString(),
      status: deposit.status,
    };
  }

  async getEscrow(projectId: string) {
    if (!Types.ObjectId.isValid(projectId)) {
      throw new BadRequestException('Invalid projectId');
    }

    const escrow = await this.escrowRepository.getEscrowByProject(
      new Types.ObjectId(projectId),
    );

    if (!escrow) {
      return null;
    }

    return escrow;
  }

  async requestRelease(dto: ReleaseDto, requestedBy: string) {
    if (!Types.ObjectId.isValid(dto.projectId)) {
      throw new BadRequestException('Invalid projectId');
    }

    await this.escrowRepository.createEventLog({
      type: EscrowEvents.RELEASE_REQUESTED,
      payload: {
        projectId: dto.projectId,
        milestoneId: dto.milestoneId,
        requestedBy,
      },
      actor: { id: requestedBy, role: 'SYSTEM' },
    });

    return {
      success: true,
      status: 'RELEASE_PENDING',
    };
  }

  async raiseDispute(dto: DisputeDto, raisedBy: string) {
    if (!Types.ObjectId.isValid(dto.escrowId)) {
      throw new BadRequestException('Invalid escrowId');
    }

    await this.escrowRepository.markDepositStatus(
      new Types.ObjectId(dto.depositId),
      DepositStatus.DISPUTED,
    );

    await this.escrowRepository.createEventLog({
      escrowId: new Types.ObjectId(dto.escrowId),
      type: EscrowEvents.DISPUTE_RAISED,
      payload: {
        depositId: dto.depositId,
        reason: dto.reason,
        evidence: dto.evidence,
      },
      actor: { id: raisedBy, role: 'INVESTOR' },
    });

    return {
      success: true,
    };
  }

  async refundDeposit(dto: RefundDto, initiatedBy: string) {
    await this.escrowRepository.markDepositStatus(
      new Types.ObjectId(dto.depositId),
      DepositStatus.REFUNDED,
    );

    await this.escrowRepository.createEventLog({
      type: EscrowEvents.REFUND_PROCESSED,
      payload: {
        depositId: dto.depositId,
        reason: dto.reason,
      },
      actor: { id: initiatedBy, role: 'ADMIN' },
    });

    return {
      success: true,
    };
  }

  async getEventsByTxHash(txHash: string) {
    return this.escrowRepository.getEventsByTxHash(txHash);
  }
}
