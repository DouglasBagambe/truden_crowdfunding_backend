import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Request,
  ServiceUnavailableException,
  ForbiddenException,
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
import { FinancialPayoutService } from './financial-payout.service';
import { FinancialPayoutWorker } from './financial-payout.worker';
import { FinancialReceiptService } from './financial-receipt.service';

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
class PayoutDestinationDto {
  @IsString() @Matches(/^(bank|mobile_money)$/) type!: 'bank' | 'mobile_money';
  @IsString() accountNumber!: string;
  @IsString() bankOrNetwork!: string;
  @IsString() accountName?: string;
}
class PayoutRequestDto {
  @IsString() destinationId!: string;
}
class ReceiptRevocationDto {
  @IsString() reason!: string;
}

const callbackValue = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : '';

@Controller('financial')
export class FinancialController {
  constructor(
    private readonly financial: FinancialService,
    private readonly flutterwave: FlutterwaveFinancialAdapter,
    private readonly outbox: FinancialOutboxService,
    private readonly payouts: FinancialPayoutService,
    private readonly payoutWorker: FinancialPayoutWorker,
    private readonly receipts: FinancialReceiptService,
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
  @Public()
  @CsrfExempt()
  @Post('payouts/flutterwave/callback')
  async flutterwavePayoutCallback(
    @Body() body: Record<string, unknown>,
    @Headers('flutterwave-signature') signature: string | undefined,
    @Request() request: { rawBody?: Buffer },
  ) {
    const raw = request.rawBody;
    if (!this.payoutWorker.verifyWebhookSignature(raw, signature))
      throw new ForbiddenException(
        'Invalid Flutterwave payout webhook signature',
      );
    const data =
      body.data && typeof body.data === 'object'
        ? (body.data as Record<string, unknown>)
        : {};
    if (body.type !== 'transfer.disburse')
      throw new ServiceUnavailableException(
        'Unsupported Flutterwave payout event',
      );
    return this.payoutWorker.callback({
      transferId: callbackValue(data.id),
      reference: callbackValue(data.reference),
      amount: callbackValue(data.amount),
      currency: callbackValue(
        data.destination_currency ?? data.currency,
      ).toUpperCase(),
      status: callbackValue(data.status).toUpperCase() as
        | 'PENDING'
        | 'PROCESSING'
        | 'SUCCESSFUL'
        | 'FAILED'
        | 'UNKNOWN',
    });
  }
  @Post('payout-destinations') createDestination(
    @Body() dto: PayoutDestinationDto,
    @Headers('idempotency-key') key: string,
    @Request() req: { user: { sub?: string; userId?: string } },
  ) {
    const creatorId = req.user?.sub ?? req.user?.userId;
    if (!creatorId) throw new Error('Authenticated user is required');
    return this.payouts.createDestination({
      ...dto,
      creatorId,
      idempotencyKey: key,
    });
  }
  @Get('payout-destinations') listDestinations(
    @Request() req: { user: { sub?: string; userId?: string } },
  ) {
    const creatorId = req.user?.sub ?? req.user?.userId;
    if (!creatorId) throw new Error('Authenticated user is required');
    return this.payouts.list(creatorId);
  }
  @Post('payout-destinations/:id/disable') disableDestination(
    @Param('id') id: string,
    @Request() req: { user: { sub?: string; userId?: string } },
  ) {
    const creatorId = req.user?.sub ?? req.user?.userId;
    if (!creatorId) throw new Error('Authenticated user is required');
    return this.payouts.disable(creatorId, id);
  }
  @Post('releases/:releaseId/payout') requestPayout(
    @Param('releaseId') releaseId: string,
    @Body() dto: PayoutRequestDto,
    @Headers('idempotency-key') key: string,
    @Request() req: { user: { sub?: string; userId?: string } },
  ) {
    const creatorId = req.user?.sub ?? req.user?.userId;
    if (!creatorId) throw new Error('Authenticated user is required');
    return this.payouts.request({
      creatorId,
      releaseId,
      destinationId: dto.destinationId,
      idempotencyKey: key,
    });
  }
  @Get('payouts') listPayouts(
    @Request() req: { user: { sub?: string; userId?: string } },
  ) {
    const creatorId = req.user?.sub ?? req.user?.userId;
    if (!creatorId) throw new Error('Authenticated user is required');
    return this.payouts.listPayouts(creatorId);
  }
  @Get('payouts/:id') getPayout(
    @Param('id') id: string,
    @Request() req: { user: { sub?: string; userId?: string } },
  ) {
    const creatorId = req.user?.sub ?? req.user?.userId;
    if (!creatorId) throw new Error('Authenticated user is required');
    return this.payouts.getPayout(creatorId, id);
  }
  @Post('receipts/:settlementId/authorize') authorizeReceipt(
    @Param('settlementId') settlementId: string,
    @Request() req: { user: { sub?: string; userId?: string } },
  ) {
    const userId = req.user?.sub ?? req.user?.userId;
    if (!userId) throw new Error('Authenticated user is required');
    return this.receipts.authorize(userId, settlementId);
  }
  @Post('receipts/:settlementId/issue') issueReceipt(
    @Param('settlementId') settlementId: string,
    @Request() req: { user: { sub?: string; userId?: string } },
  ) {
    const userId = req.user?.sub ?? req.user?.userId;
    if (!userId) throw new Error('Authenticated user is required');
    return this.receipts.issue(userId, settlementId);
  }
  @Get('receipts/:settlementId') getReceipt(
    @Param('settlementId') settlementId: string,
    @Request() req: { user: { sub?: string; userId?: string } },
  ) {
    const userId = req.user?.sub ?? req.user?.userId;
    if (!userId) throw new Error('Authenticated user is required');
    return this.receipts.get(userId, settlementId);
  }
  @Roles(UserRole.ADMIN, UserRole.SUPERADMIN)
  @Post('receipts/:id/revoke')
  revokeReceipt(
    @Param('id') id: string,
    @Body() dto: ReceiptRevocationDto,
    @Request() req: { user: { sub?: string; userId?: string } },
  ) {
    const userId = req.user?.sub ?? req.user?.userId;
    if (!userId) throw new Error('Authenticated user is required');
    return this.receipts.requestRevocation(userId, id, dto.reason);
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
