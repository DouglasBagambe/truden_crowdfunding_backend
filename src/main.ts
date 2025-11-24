import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import appConfig from './config/app.config';

type AppConfig = ReturnType<typeof appConfig>;

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get<ConfigService<AppConfig>>(ConfigService);

  const corsConfig = configService.get<AppConfig['cors']>('cors');
  const corsOrigin = corsConfig?.origin ?? ['http://localhost:3000'];
  app.enableCors({
    origin: corsOrigin,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.setGlobalPrefix('api');

  const port = configService.get<number>('port') || 3000;
  await app.listen(port);

  console.log(`Application is running on: http://localhost:${port}/api`);
  console.log(`Auth endpoints available at: http://localhost:${port}/api/auth`);
}
bootstrap().catch((error) => {
  console.error('Failed to start application:', error);
  process.exit(1);
});
