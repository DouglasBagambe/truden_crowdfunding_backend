import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import appConfig from './config/app.config';
import { validateEnvironment } from './config/validate-env';
import { FinancialModule } from './modules/financial/financial.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig],
      envFilePath: '.env',
      validate: validateEnvironment,
    }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const uri =
          config.get<string>('database.uri') ?? config.get<string>('MONGO_URI');
        if (!uri)
          throw new Error('MONGO_URI is required for financial workers');
        return { uri };
      },
    }),
    FinancialModule,
  ],
})
class FinancialWorkerModule {}

async function bootstrapFinancialWorker(): Promise<void> {
  if (process.env.FINANCIAL_WORKERS_ENABLED !== 'true') {
    throw new Error(
      'FINANCIAL_WORKERS_ENABLED must be true for worker startup',
    );
  }

  const application = await NestFactory.createApplicationContext(
    FinancialWorkerModule,
  );
  application.enableShutdownHooks();
  console.log('KEIBO financial worker started');
}

bootstrapFinancialWorker().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown error';
  console.error(`Financial worker failed to start: ${message}`);
  process.exit(1);
});
