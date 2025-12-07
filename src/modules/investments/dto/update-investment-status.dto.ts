import { IsEnum } from 'class-validator';
import { InvestmentStatus } from '../interfaces/investment.interface';

export class UpdateInvestmentStatusDto {
  @IsEnum(InvestmentStatus)
  status!: InvestmentStatus;
}
