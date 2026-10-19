import { Module } from '@nestjs/common';
import { FinancialDatabase } from './financial.database';

@Module({ providers: [FinancialDatabase], exports: [FinancialDatabase] })
export class FinancialDatabaseModule {}
