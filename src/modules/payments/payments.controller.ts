import {
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
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { PaymentsService } from './payments.service';
import { InitializePaymentDto } from './dto/initialize-payment.dto';
import {
    DepositToWalletDto,
    WithdrawFromWalletDto,
    AddWithdrawalMethodDto,
    WalletInvestmentDto,
} from './dto/wallet.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';

@ApiTags('Payments')
@Controller('payments')
export class PaymentsController {
    constructor(private readonly paymentsService: PaymentsService) { }

    @Post('initialize')
    @UseGuards(JwtAuthGuard)
    @ApiBearerAuth('JWT-auth')
    @ApiOperation({ summary: 'Initialize a payment for investment' })
    @ApiResponse({ status: 201, description: 'Payment initialized successfully' })
    async initializePayment(
        @Body() dto: InitializePaymentDto,
        @Request() req: any,
    ) {
        return this.paymentsService.initializePayment(dto, req.user.userId);
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
        return this.paymentsService.getUserTransactions(req.user.userId);
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
        const wallet = await this.paymentsService.getOrCreateWallet(req.user.userId);
        return {
            fiatBalance: wallet.fiatBalance,
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
            req.user.userId,
            req.user.email,
        );
    }

    @Post('invest')
    @ApiOperation({ summary: 'Invest using wallet balance' })
    @ApiResponse({ status: 201, description: 'Investment processed' })
    async invest(@Body() dto: WalletInvestmentDto, @Request() req: any) {
        return this.paymentsService.processWalletInvestment(dto, req.user.userId);
    }

    @Post('withdraw')
    @ApiOperation({ summary: 'Withdraw from wallet' })
    @ApiResponse({ status: 201, description: 'Withdrawal initiated' })
    async withdraw(@Body() dto: WithdrawFromWalletDto, @Request() req: any) {
        return this.paymentsService.withdrawFromWallet(dto, req.user.userId);
    }

    @Post('withdrawal-method')
    @ApiOperation({ summary: 'Add withdrawal method' })
    @ApiResponse({ status: 201, description: 'Withdrawal method added' })
    async addWithdrawalMethod(
        @Body() dto: AddWithdrawalMethodDto,
        @Request() req: any,
    ) {
        return this.paymentsService.addWithdrawalMethod(dto, req.user.userId);
    }

    @Get('transactions')
    @ApiOperation({ summary: 'Get wallet transactions' })
    @ApiResponse({ status: 200, description: 'List of wallet transactions' })
    async getTransactions(@Request() req: any) {
        return this.paymentsService.getUserTransactions(req.user.userId);
    }

    @Get()
    @ApiOperation({ summary: 'Get full wallet details' })
    @ApiResponse({ status: 200, description: 'Wallet details' })
    async getWallet(@Request() req: any) {
        return this.paymentsService.getOrCreateWallet(req.user.userId);
    }
}
