import { IsString, IsNumber, IsEnum, IsOptional, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PaymentMethod } from '../schemas/payment-transaction.schema';

export class InitializeDPOPaymentDto {
    @ApiProperty({ description: 'Project ID', example: '6543c...' })
    @IsString()
    projectId!: string;

    @ApiProperty({ description: 'Amount (e.g. 10000 UGX)', example: 10000 })
    @IsNumber()
    @Min(500)
    amount!: number;

    @ApiProperty({ description: 'Currency code', example: 'UGX', default: 'UGX' })
    @IsString()
    @IsOptional()
    currency?: string;

    @ApiProperty({
        description: 'Payment method',
        enum: PaymentMethod,
        example: PaymentMethod.Card,
    })
    @IsEnum(PaymentMethod)
    @IsOptional()
    paymentMethod?: PaymentMethod;

    @ApiProperty({ description: 'Project type: CHARITY or ROI', example: 'CHARITY' })
    @IsString()
    @IsOptional()
    projectType?: string;

    @ApiProperty({ description: 'Payment description', required: false })
    @IsString()
    @IsOptional()
    description?: string;

    @ApiProperty({ description: 'Donor name for charity projects', required: false })
    @IsString()
    @IsOptional()
    donorName?: string;
}
