import { IsString, IsNumber, IsEnum, IsOptional, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { WithdrawalMethodType } from '../schemas/wallet.schema';

export class DepositToWalletDto {
    @ApiProperty({ description: 'Amount to deposit', example: 100000 })
    @IsNumber()
    @Min(5000) // Minimum 5000 UGX
    amount!: number;

    @ApiProperty({ description: 'Currency code', example: 'UGX', default: 'UGX' })
    @IsString()
    @IsOptional()
    currency?: string = 'UGX';

    @ApiProperty({
        description: 'Redirect URL after payment',
        example: 'http://localhost:3000/profile/wallet',
    })
    @IsString()
    redirectUrl!: string;
}

export class WithdrawFromWalletDto {
    @ApiProperty({ description: 'Amount to withdraw', example: 50000 })
    @IsNumber()
    @Min(10000) // Minimum 10000 UGX
    amount!: number;

    @ApiProperty({ description: 'Currency code', example: 'UGX', default: 'UGX' })
    @IsString()
    currency!: string;

    @ApiProperty({ description: 'Withdrawal method ID (index in array)' })
    @IsNumber()
    withdrawalMethodIndex!: number;

    @ApiProperty({ description: 'Optional note for the withdrawal', required: false })
    @IsString()
    @IsOptional()
    note?: string;
}

export class AddWithdrawalMethodDto {
    @ApiProperty({
        description: 'Withdrawal method type',
        enum: WithdrawalMethodType,
    })
    @IsEnum(WithdrawalMethodType)
    type!: WithdrawalMethodType;

    @ApiProperty({
        description: 'Provider name',
        example: 'mtn',
    })
    @IsString()
    provider!: string;

    @ApiProperty({
        description: 'Account number or phone number',
        example: '256700000000',
    })
    @IsString()
    accountNumber!: string;

    @ApiProperty({
        description: 'Account holder name',
        example: 'John Doe',
    })
    @IsString()
    accountName!: string;

    @ApiProperty({
        description: 'Set as default withdrawal method',
        default: false,
    })
    @IsOptional()
    isDefault?: boolean;
}

export class WalletInvestmentDto {
    @ApiProperty({ description: 'Amount to invest from wallet', example: 50000 })
    @IsNumber()
    @Min(1000)
    amount!: number;

    @ApiProperty({ description: 'Currency code', example: 'UGX' })
    @IsString()
    currency!: string;

    @ApiProperty({ description: 'Project ID to invest in' })
    @IsString()
    projectId!: string;
}
