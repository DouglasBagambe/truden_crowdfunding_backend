import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Request,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { IsEthereumAddress, IsString, Matches } from 'class-validator';
import { Public } from '../../common/decorators/public.decorator';
import { CsrfExempt } from '../../common/decorators/csrf-exempt.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/role.enum';
import { FinancialService } from './financial.service';
import { FlutterwaveFinancialAdapter } from './providers/flutterwave-financial.adapter';
import { FinancialOutboxService } from './financial-outbox.service';

class CreatePaymentIntentDto {
  @IsString() projectId!: string;
  @IsString() @Matches(/^\d+$/) amountMinor!: string;
  @IsString() @Matches(/^[A-Za-z]{3}$/) currency!: string;
}
class ReconcileDto {
  @IsString() provider!: string;
  @IsString() @Matches(/^[A-Za-z]{3}$/) currency!: string;
  @IsString() @Matches(/^\d+$/) providerTotalMinor!: string;
  @IsString() evidenceReference!: string;
}
class SubmitOnchainContributionDto {
  @IsString() paymentIntentId!: string;
  @IsString() @Matches(/^\d+$/) projectOnchainId!: string;
  @IsEthereumAddress() investorWallet!: string;
  @IsString() @Matches(/^0x[0-9a-fA-F]{64}$/) transactionHash!: string;
}

@Controller('financial')
export class FinancialController {
  constructor(
    private readonly financial: FinancialService,
    private readonly flutterwave: FlutterwaveFinancialAdapter,
    private readonly outbox: FinancialOutboxService,
  ) {}

  @Post('payment-intents')
  createIntent(
    @Body() dto: CreatePaymentIntentDto,
    @Headers('idempotency-key') idempotencyKey: string,
    @Request() request: { user: { sub?: string; userId?: string } },
  ) {
    const contributorId = request.user?.sub ?? request.user?.userId;
    if (!contributorId) throw new Error('Authenticated user is required');
    return this.financial.createPaymentIntent({
      projectId: dto.projectId,
      contributorId,
      amountMinor: BigInt(dto.amountMinor),
      currency: dto.currency,
      idempotencyKey,
      correlationId: randomUUID(),
    });
  }

  @Get('payment-intents/:id')
  getIntent(
    @Param('id') id: string,
    @Request() request: { user: { sub?: string; userId?: string } },
  ) {
    const contributorId = request.user?.sub ?? request.user?.userId;
    if (!contributorId) throw new Error('Authenticated user is required');
    return this.financial.getPaymentIntent(id, contributorId);
  }

  @Post('onchain-contributions')
  submitOnchainContribution(
    @Body() dto: SubmitOnchainContributionDto,
    @Request() request: { user: { sub?: string; userId?: string } },
  ) {
    const contributorId = request.user?.sub ?? request.user?.userId;
    if (!contributorId) throw new Error('Authenticated user is required');
    return this.financial.settleVerifiedOnchainContribution({
      paymentIntentId: dto.paymentIntentId,
      contributorId,
      projectOnchainId: dto.projectOnchainId,
      investorWallet: dto.investorWallet as `0x${string}`,
      transactionHash: dto.transactionHash as `0x${string}`,
      correlationId: randomUUID(),
    });
  }

  @Public()
  @CsrfExempt()
  @Post('webhooks/flutterwave')
  receiveFlutterwave(
    @Body() payload: Record<string, unknown>,
    @Headers('verif-hash') signature?: string,
  ) {
    return this.financial.acceptProviderEvent(
      this.flutterwave.verifyAndNormalize(payload, signature),
    );
  }

  @Roles(UserRole.ADMIN)
  @Post('reconciliations')
  reconcile(@Body() dto: ReconcileDto) {
    return this.financial.reconcile(dto);
  }

  @Public()
  @Get('health/ready')
  async readiness() {
    const result = {
      ...(await this.financial.readiness()),
      financialQueue: await this.outbox.readiness(),
    };
    if (!result.financialDatabase || !result.financialQueue) {
      throw new ServiceUnavailableException('Financial dependencies not ready');
    }
    return { status: 'ready', ...result };
  }
}
