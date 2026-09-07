import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import appConfig from './config/app.config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import express from 'express';
import type { NestExpressApplication } from '@nestjs/platform-express';

type AppConfig = ReturnType<typeof appConfig>;

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });
  const configService = app.get<ConfigService>(ConfigService);

  const corsConfig = configService.get<AppConfig['cors']>('cors');
  const corsOrigin = corsConfig?.origin ?? [];
  app.enableCors({
    origin: corsOrigin,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-CSRF-Token'],
    maxAge: 600,
  });

  const trustProxy = configService.get<string>('TRUST_PROXY')?.trim();
  if (trustProxy) {
    app.set('trust proxy', trustProxy);
  }
  app.use(cookieParser());
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'self'"],
        },
      },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ limit: '2mb', extended: true }));

  // Global validation pipe with combined options
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('KEIBO API')
    .setDescription('KEIBO campaign and funding API')
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        name: 'JWT',
        description: 'Enter JWT token',
        in: 'header',
      },
      'JWT-auth',
    )
    .build();

  if (configService.get<string>('NODE_ENV') !== 'production') {
    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup(`api/docs`, app, document, {
      swaggerOptions: {
        persistAuthorization: false,
        tagsSorter: 'alpha',
        operationsSorter: 'alpha',
      },
    });
  }

  app.setGlobalPrefix('api');

  // Port configuration
  const port = configService.get<number>('port') || process.env.PORT || 3000;
  await app.listen(port);

  console.log(`Application is running on: http://localhost:${port}/api`);
  console.log(`Auth endpoints available at: http://localhost:${port}/api/auth`);
  console.log(
    `Users endpoints available at: http://localhost:${port}/api/users`,
  );
  console.log(
    `Projects endpoints available at: http://localhost:${port}/api/projects`,
  );
  console.log(
    `Investments endpoints available at: http://localhost:${port}/api/investments`,
  );
  console.log(`NFT endpoints available at: http://localhost:${port}/api/nfts`);
  console.log(
    `Treasury endpoints available at: http://localhost:${port}/api/treasury`,
  );
  console.log(`KYC endpoints available at: http://localhost:${port}/api/kyc`);
}

bootstrap().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : 'Unknown startup error';
  console.error(`Failed to start application: ${message}`);
  process.exit(1);
});
