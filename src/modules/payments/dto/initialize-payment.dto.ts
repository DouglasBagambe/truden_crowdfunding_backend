import { IsString, IsNumber, IsEnum, IsOptional, IsEmail, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PaymentMethod, MobileMoneyProvider } from '../schemas/payment-transaction.schema';

export class InitializePaymentDto {
    @ApiProperty({ description: 'Amount to pay', example: 50000 })
    @IsNumber()
    @Min(1000) // Minimum 1000 UGX
    amount!: number;

    @ApiProperty({ description: 'Currency code', example: 'UGX', default: 'UGX' })
    @IsString()
    @IsOptional()
    currency?: string = 'UGX';

    @ApiProperty({ description: 'User email', example: 'user@example.com' })
    @IsEmail()
    email!: string;

    @ApiProperty({
        description: 'Payment method',
        enum: PaymentMethod,
        example: PaymentMethod.MobileMoney,
    })
    @IsEnum(PaymentMethod)
    paymentMethod!: PaymentMethod;

    @ApiProperty({ description: 'Project ID to invest in' })
    @IsString()
    projectId!: string;

    @ApiProperty({
        description: 'Phone number for mobile money',
        example: '256700000000',
        required: false,
    })
    @IsString()
    @IsOptional()
    phoneNumber?: string;

    @ApiProperty({
        description: 'Mobile money provider',
        enum: MobileMoneyProvider,
        required: false,
    })
    @IsEnum(MobileMoneyProvider)
    @IsOptional()
    mobileMoneyProvider?: MobileMoneyProvider;

    @ApiProperty({
        description: 'Redirect URL after payment',
        example: 'http://localhost:3000/investment/success',
    })
    @IsString()
    redirectUrl!: string;
}
