import {
  BadRequestException,
  Controller,
  Post,
  Get,
  Body,
  Param,
  Headers,
  UseGuards,
  Request as RequestDecorator,
  HttpCode,
  HttpStatus,
  Query,
  Logger,
  HttpException,
  Redirect,
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
} from '@nestjs/swagger';
import type { Request as ExpressRequest } from 'express';
import { PaymentsService } from './payments.service';
import { InitializePaymentDto } from './dto/initialize-payment.dto';
import { InitializeDPOPaymentDto } from './dto/initialize-dpo-payment.dto';
import { DpoPaymentQuoteDto } from './dto/dpo-payment-quote.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';
import { PaymentMethod } from './schemas/payment-transaction.schema';
import { EmailVerifiedGuard } from '../../common/guards/email-verified.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/role.enum';
import { KYCStatus } from '../../common/enums/role.enum';
import { UsersService } from '../users/users.service';
import { Public } from '../../common/decorators/public.decorator';
import { CsrfExempt } from '../../common/decorators/csrf-exempt.decorator';

type AuthenticatedRequest = ExpressRequest & {
  user?: { userId?: string; sub?: string };
};

@ApiTags('Payments')
@Controller('payments')
export class PaymentsController {
  private readonly logger = new Logger(PaymentsController.name);
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly usersService: UsersService,
  ) {}

  private getFrontendUrl(): string {
    return (process.env.FRONTEND_URL || '')
      .trim()
      .replace(/[,\s]+$/, '')
      .replace(/\/+$/, '');
  }

  @Post('initialize')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Initialize a payment for investment' })
  @ApiResponse({ status: 201, description: 'Payment initialized successfully' })
  initializePayment(
    @Body() dto: InitializePaymentDto,
    @RequestDecorator() req: AuthenticatedRequest,
  ) {
    void dto;
    void req;
    throw new BadRequestException(
      'Legacy Flutterwave checkout is disabled. Use the DPO checkout flow instead.',
    );
  }

  @Post('verify/:txRef')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Verify payment status' })
  @ApiResponse({ status: 200, description: 'Payment verification result' })
  async verifyPayment(@Param('txRef') txRef: string) {
    return this.paymentsService.verifyPayment(txRef);
  }

  @Post('webhook')
  @Public()
  @CsrfExempt()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Flutterwave webhook handler' })
  @ApiResponse({ status: 200, description: 'Webhook processed' })
  handleWebhook(
    @Headers('verif-hash') signature: string,
    @Body() payload: Record<string, unknown>,
  ) {
    return this.paymentsService.handleWebhook(signature, payload);
  }

  @Post('dpo/initialize')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary:
      'Create DPO payment token — returns redirect URL to DPO hosted payment page',
  })
  @ApiResponse({
    status: 201,
    description:
      'Returns token + redirectUrl. Frontend should window.location.href to redirectUrl.',
  })
  async initializeDPOPayment(
    @Body() dto: InitializeDPOPaymentDto,
    @RequestDecorator() req: AuthenticatedRequest,
  ) {
    try {
      const userId = req.user?.userId ?? req.user?.sub;
      const { projectType } = await this.paymentsService.resolveCheckoutProject(
        dto.projectId,
      );
      const isCharity = projectType === 'CHARITY';
      const user =
        !isCharity && userId
          ? await this.usersService.getUserById(userId)
          : null;

      if (!userId) {
        throw new UnauthorizedException(
          'Please sign in before starting a payment.',
        );
      }

      if (!isCharity && !user?.emailVerifiedAt) {
        throw new ForbiddenException(
          'Email not verified. Please verify your email address to perform this action.',
        );
      }

      if (!isCharity && userId) {
        if (user?.kycStatus !== KYCStatus.VERIFIED) {
          throw new ForbiddenException(
            'KYC not verified. Please complete and verify KYC before investing.',
          );
        }
      }

      return await this.paymentsService.initializeDPOPayment(
        { ...dto, paymentMethod: dto.paymentMethod ?? PaymentMethod.Card },
        userId,
      );
    } catch (error: unknown) {
      if (error instanceof HttpException) {
        throw error;
      }
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to initialize DPO payment';
      this.logger.error('DPO initialize error:', message);
      throw new HttpException(message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Post('dpo/quote')
  @Public()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary: 'Calculate DPO checkout quote from a desired net project amount',
  })
  async getDPOPaymentQuote(@Body() dto: DpoPaymentQuoteDto) {
    return this.paymentsService.getDPOPaymentQuote(dto);
  }

  @Get('dpo/verify/:token')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Verify DPO payment status by token' })
  async verifyDPOPayment(
    @Param('token') token: string,
    @RequestDecorator() req: AuthenticatedRequest,
  ) {
    return this.paymentsService.verifyDPOPayment(
      token,
      req.user?.userId ?? req.user?.sub,
    );
  }

  @Post('dpo/repair/:token')
  @Roles(UserRole.ADMIN)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Re-run DPO verification and repair a paid transaction by token',
  })
  async repairDPOPayment(@Param('token') token: string) {
    return this.paymentsService.repairDPOPaymentByToken(token);
  }

  @Post('payout-callback')
  @HttpCode(HttpStatus.OK)
  @Public()
  @CsrfExempt()
  @ApiOperation({ summary: 'Flutterwave payout callback handler' })
  async handlePayoutCallback(
    @Body() payload: Record<string, unknown>,
    @Headers('verif-hash') signature?: string,
  ) {
    return this.paymentsService.handlePayoutCallback(payload, signature);
  }

  @Post('dpo/webhook')
  @HttpCode(HttpStatus.OK)
  @Public()
  @CsrfExempt()
  @ApiOperation({ summary: 'DPO server-to-server IPN (POST)' })
  async handleDPOWebhook(
    @Body() payload: Record<string, string>,
    @Query() query: Record<string, string>,
  ) {
    return this.paymentsService.handleDPOWebhook({ ...query, ...payload });
  }

  @Get('dpo/webhook')
  @Redirect()
  @Public()
  @ApiOperation({ summary: 'DPO BackURL / ReturnURL redirect handler (GET)' })
  async handleDPOWebhookGet(@Query() query: Record<string, string>) {
    const frontendUrl = this.getFrontendUrl();

    // DPO sends the token as 'TransactionToken' in query string on BackURL calls
    const token = query.TransactionToken || query.token || query.ID;
    const projectId =
      query.CompanyRef?.split('-')?.[1] || query.projectId || '';

    try {
      if (token) {
        // Try to verify the payment — DPO may call BackURL for both success and cancel
        const result = await this.paymentsService.verifyDPOPayment(token);

        const status = String(result.status).toLowerCase();
        if (['captured', 'settled', 'released'].includes(status)) {
          // Payment confirmed — send user to success page with token for frontend verify
          return {
            url: `${frontendUrl}/payment/result?status=success&projectId=${projectId}`,
          };
        } else if (status === 'cancelled') {
          return {
            url: `${frontendUrl}/payment/result?status=cancelled&projectId=${projectId}`,
          };
        } else if (status === 'failed') {
          return {
            url: `${frontendUrl}/payment/result?status=failed&projectId=${projectId}`,
          };
        }
        // Pending/processing/provider uncertainty should stay pending, never hard-fail here.
        return {
          url: `${frontendUrl}/payment/result?status=pending&projectId=${projectId}`,
        };
      }
    } catch (err) {
      this.logger.error('Error in DPO GET Webhook handler:', err);
      if (token) {
        return {
          url: `${frontendUrl}/payment/result?status=pending&projectId=${projectId}`,
        };
      }
    }

    return {
      url: `${frontendUrl}/payment/result?status=cancelled&projectId=${projectId}`,
    };
  }

  @Get('transaction/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get transaction details' })
  @ApiResponse({ status: 200, description: 'Transaction details' })
  async getTransaction(@Param('id') id: string) {
    return this.paymentsService.getTransaction(id);
  }

  @Get('user/transactions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Get user payment history' })
  @ApiResponse({ status: 200, description: 'List of user transactions' })
  async getUserTransactions(@RequestDecorator() req: AuthenticatedRequest) {
    const userId = req.user?.userId ?? req.user?.sub;
    if (!userId) throw new UnauthorizedException('Authentication required');
    return this.paymentsService.getUserTransactions(userId);
  }
}

@ApiTags('Wallet')
@Controller('wallet')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')
export class WalletController {
  constructor(private readonly paymentsService: PaymentsService) {}

  private unavailable(): never {
    throw new ServiceUnavailableException(
      'Legacy wallet balances and mutations are disabled until ledger-backed wallet adapters are configured',
    );
  }

  @Get('balance')
  @ApiOperation({ summary: 'Get wallet balance' })
  @ApiResponse({ status: 200, description: 'Wallet balance' })
  getBalance() {
    return this.unavailable();
  }

  @Post('deposit')
  @ApiOperation({ summary: 'Deposit to wallet via Flutterwave' })
  @ApiResponse({ status: 201, description: 'Deposit initiated' })
  deposit() {
    return this.unavailable();
  }

  @Post('invest')
  @ApiOperation({ summary: 'Invest using wallet balance' })
  @ApiResponse({ status: 201, description: 'Investment processed' })
  invest() {
    return this.unavailable();
  }

  @Post('withdraw')
  @UseGuards(EmailVerifiedGuard)
  @ApiOperation({ summary: 'Withdraw from wallet' })
  @ApiResponse({ status: 201, description: 'Withdrawal initiated' })
  withdraw() {
    return this.unavailable();
  }

  @Post('admin/withdrawals/:id/approve')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Admin approve an ROI withdrawal' })
  @ApiResponse({
    status: 200,
    description: 'Withdrawal approved and processed',
  })
  approveRoiWithdrawal() {
    return this.unavailable();
  }

  @Get('admin/withdrawals/pending')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Admin get pending ROI withdrawals' })
  @ApiResponse({ status: 200, description: 'List of pending withdrawals' })
  getPendingWithdrawals() {
    return this.unavailable();
  }

  @Post('admin/withdrawals/:id/reject')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Admin reject an ROI withdrawal' })
  @ApiResponse({ status: 200, description: 'Withdrawal rejected and refunded' })
  rejectRoiWithdrawal() {
    return this.unavailable();
  }

  @Post('withdrawal-method')
  @ApiOperation({ summary: 'Add withdrawal method' })
  @ApiResponse({ status: 201, description: 'Withdrawal method added' })
  addWithdrawalMethod() {
    return this.unavailable();
  }

  @Get('transactions')
  @ApiOperation({ summary: 'Get wallet transactions' })
  @ApiResponse({ status: 200, description: 'List of wallet transactions' })
  getTransactions() {
    return this.unavailable();
  }

  @Get()
  @ApiOperation({ summary: 'Get full wallet details' })
  @ApiResponse({ status: 200, description: 'Wallet details' })
  getWallet() {
    return this.unavailable();
  }
}
