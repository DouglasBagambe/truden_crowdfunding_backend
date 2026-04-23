import {
    BadRequestException,
    Controller,
    Post,
    Get,
    Body,
    Param,
    Headers,
    UseGuards,
    Request,
    HttpCode,
    HttpStatus,
    Query,
    Logger,
    HttpException,
    Redirect,
    ForbiddenException,
    UnauthorizedException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse, ApiBody } from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import { InitializePaymentDto } from './dto/initialize-payment.dto';
import { InitializeDPOPaymentDto } from './dto/initialize-dpo-payment.dto';
import { DpoPaymentQuoteDto } from './dto/dpo-payment-quote.dto';
import {
    DepositToWalletDto,
    WithdrawFromWalletDto,
    AddWithdrawalMethodDto,
    WalletInvestmentDto,
} from './dto/wallet.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../../common/guards/optional-jwt-auth.guard';
import { PaymentMethod, PaymentStatus } from './schemas/payment-transaction.schema';
import { EmailVerifiedGuard } from '../../common/guards/email-verified.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/role.enum';
import { KYCStatus } from '../../common/enums/role.enum';
import { UsersService } from '../users/users.service';
import { Public } from '../../common/decorators/public.decorator';

@ApiTags('Payments')
@Controller('payments')
export class PaymentsController {
    private readonly logger = new Logger(PaymentsController.name);
    constructor(
        private readonly paymentsService: PaymentsService,
        private readonly usersService: UsersService,
    ) { }

    private getFrontendUrl(): string {
        return (process.env.FRONTEND_URL || 'https://keibo.netlify.app')
            .trim()
            .replace(/[,\s]+$/, '')
            .replace(/\/+$/, '');
    }

    @Post('initialize')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('JWT-auth')
    @ApiOperation({ summary: 'Initialize a payment for investment' })
    @ApiResponse({ status: 201, description: 'Payment initialized successfully' })
    async initializePayment(
        @Body() dto: InitializePaymentDto,
        @Request() req: any,
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
    @HttpCode(HttpStatus.OK)
    @ApiOperation({ summary: 'Flutterwave webhook handler' })
    @ApiResponse({ status: 200, description: 'Webhook processed' })
    async handleWebhook(
        @Headers('verif-hash') signature: string,
        @Body() payload: any,
    ) {
        return this.paymentsService.handleWebhook(signature, payload);
    }

    @Post('dpo/initialize')
    @Public()
    @UseGuards(OptionalJwtAuthGuard)
    @ApiOperation({ summary: 'Create DPO payment token — returns redirect URL to DPO hosted payment page' })
    @ApiResponse({ status: 201, description: 'Returns token + redirectUrl. Frontend should window.location.href to redirectUrl.' })
    async initializeDPOPayment(
        @Body() dto: InitializeDPOPaymentDto,
        @Request() req: any,
    ) {
        try {
            const userId = req.user?.userId ?? req.user?.sub;
            const { projectType } = await this.paymentsService.resolveCheckoutProject(dto.projectId);
            const isCharity = projectType === 'CHARITY';
            const user = !isCharity && userId
                ? await this.usersService.getUserById(userId)
                : null;

            if (!isCharity && !userId) {
                throw new UnauthorizedException('Please sign in to invest in ROI projects.');
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
        } catch (err: any) {
            if (err instanceof HttpException) {
                throw err;
            }
            this.logger.error('DPO initialize error:', err?.message, err?.stack);
            throw new HttpException(
                err?.message || 'Failed to initialize DPO payment',
                err?.status ?? 500,
            );
        }
    }

    @Post('dpo/quote')
    @Public()
    @UseGuards(OptionalJwtAuthGuard)
    @ApiOperation({ summary: 'Calculate DPO checkout quote from a desired net project amount' })
    async getDPOPaymentQuote(@Body() dto: DpoPaymentQuoteDto) {
        return this.paymentsService.getDPOPaymentQuote(dto);
    }

    @Get('dpo/verify/:token')
    @Public()
    @UseGuards(OptionalJwtAuthGuard)
    @ApiBearerAuth('JWT-auth')
    @ApiOperation({ summary: 'Verify DPO payment status by token' })
    async verifyDPOPayment(@Param('token') token: string) {
        return this.paymentsService.verifyDPOPayment(token);
    }

    @Post('dpo/repair/:token')
    @Roles(UserRole.ADMIN)
    @ApiBearerAuth('JWT-auth')
    @ApiOperation({ summary: 'Re-run DPO verification and repair a paid transaction by token' })
    async repairDPOPayment(@Param('token') token: string) {
        return this.paymentsService.repairDPOPaymentByToken(token);
    }

    @Post('payout-callback')
    @HttpCode(HttpStatus.OK)
    @Public()
    @ApiOperation({ summary: 'Flutterwave payout callback handler' })
    async handlePayoutCallback(
        @Body() payload: any,
        @Query('token') callbackToken?: string,
    ) {
        return this.paymentsService.handlePayoutCallback(payload, callbackToken);
    }

    @Post('dpo/webhook')
    @HttpCode(HttpStatus.OK)
    @Public()
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
        const projectId = query.CompanyRef?.split('-')?.[1] || query.projectId || '';

        try {
            if (token) {
                // Try to verify the payment — DPO may call BackURL for both success and cancel
                const result = await this.paymentsService.verifyDPOPayment(token);

                if (result.status === PaymentStatus.Successful) {
                    // Payment confirmed — send user to success page with token for frontend verify
                    return { url: `${frontendUrl}/payment/result?status=success&ID=${token}&projectId=${projectId}` };
                } else if (result.status === PaymentStatus.Cancelled) {
                    return { url: `${frontendUrl}/payment/result?status=cancelled&ID=${token}&projectId=${projectId}` };
                } else if (result.status === PaymentStatus.Failed) {
                    return { url: `${frontendUrl}/payment/result?status=failed&ID=${token}&projectId=${projectId}` };
                }
                // Pending/processing/provider uncertainty should stay pending, never hard-fail here.
                return { url: `${frontendUrl}/payment/result?status=pending&ID=${token}&projectId=${projectId}` };
            }
        } catch (err) {
            this.logger.error('Error in DPO GET Webhook handler:', err);
            if (token) {
                return { url: `${frontendUrl}/payment/result?status=pending&ID=${token}&projectId=${projectId}` };
            }
        }

        return { url: `${frontendUrl}/payment/result?status=cancelled&projectId=${projectId}` };
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
    async getUserTransactions(@Request() req: any) {
        return this.paymentsService.getUserTransactions(req.user.userId ?? req.user.sub);
    }
}

@ApiTags('Wallet')
@Controller('wallet')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')
export class WalletController {
    constructor(private readonly paymentsService: PaymentsService) { }

    @Get('balance')
    @ApiOperation({ summary: 'Get wallet balance' })
    @ApiResponse({ status: 200, description: 'Wallet balance' })
    async getBalance(@Request() req: any) {
        const userId = req.user.userId ?? req.user.sub;
        const wallet = await this.paymentsService.getOrCreateWallet(userId);
        return {
            fiatBalance: wallet.fiatBalance,
            roiBalance: wallet.roiBalance,
            cryptoBalance: wallet.cryptoBalance,
            totalBalanceUSD: wallet.totalBalanceUSD,
        };
    }

    @Post('deposit')
    @ApiOperation({ summary: 'Deposit to wallet via Flutterwave' })
    @ApiResponse({ status: 201, description: 'Deposit initiated' })
    async deposit(@Body() dto: DepositToWalletDto, @Request() req: any) {
        return this.paymentsService.depositToWallet(
            dto,
            req.user.userId ?? req.user.sub,
            req.user.email,
        );
    }

    @Post('invest')
    @ApiOperation({ summary: 'Invest using wallet balance' })
    @ApiResponse({ status: 201, description: 'Investment processed' })
    async invest(@Body() dto: WalletInvestmentDto, @Request() req: any) {
        return this.paymentsService.processWalletInvestment(dto, req.user.userId ?? req.user.sub);
    }

    @Post('withdraw')
    @UseGuards(EmailVerifiedGuard)
    @ApiOperation({ summary: 'Withdraw from wallet' })
    @ApiResponse({ status: 201, description: 'Withdrawal initiated' })
    async withdraw(@Body() dto: WithdrawFromWalletDto, @Request() req: any) {
        return this.paymentsService.withdrawFromWallet(dto, req.user.userId ?? req.user.sub);
    }

    @Post('admin/withdrawals/:id/approve')
    @Roles(UserRole.ADMIN)
    @ApiOperation({ summary: 'Admin approve an ROI withdrawal' })
    @ApiResponse({ status: 200, description: 'Withdrawal approved and processed' })
    async approveRoiWithdrawal(@Param('id') transactionId: string) {
        return this.paymentsService.approveRoiWithdrawal(transactionId);
    }

    @Get('admin/withdrawals/pending')
    @Roles(UserRole.ADMIN)
    @ApiOperation({ summary: 'Admin get pending ROI withdrawals' })
    @ApiResponse({ status: 200, description: 'List of pending withdrawals' })
    async getPendingWithdrawals() {
        return this.paymentsService.getPendingWithdrawals();
    }

    @Post('admin/withdrawals/:id/reject')
    @Roles(UserRole.ADMIN)
    @ApiOperation({ summary: 'Admin reject an ROI withdrawal' })
    @ApiResponse({ status: 200, description: 'Withdrawal rejected and refunded' })
    async rejectRoiWithdrawal(@Param('id') transactionId: string) {
        return this.paymentsService.rejectRoiWithdrawal(transactionId);
    }

    @Post('withdrawal-method')
    @ApiOperation({ summary: 'Add withdrawal method' })
    @ApiResponse({ status: 201, description: 'Withdrawal method added' })
    async addWithdrawalMethod(
        @Body() dto: AddWithdrawalMethodDto,
        @Request() req: any,
    ) {
        return this.paymentsService.addWithdrawalMethod(dto, req.user.userId ?? req.user.sub);
    }

    @Get('transactions')
    @ApiOperation({ summary: 'Get wallet transactions' })
    @ApiResponse({ status: 200, description: 'List of wallet transactions' })
    async getTransactions(@Request() req: any) {
        return this.paymentsService.getUserTransactions(req.user.userId ?? req.user.sub);
    }

    @Get()
    @ApiOperation({ summary: 'Get full wallet details' })
    @ApiResponse({ status: 200, description: 'Wallet details' })
    async getWallet(@Request() req: any) {
        return this.paymentsService.getOrCreateWallet(req.user.userId ?? req.user.sub);
    }
}
