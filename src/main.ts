import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import appConfig from './config/app.config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

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
    .setTitle('E-NGO Management API')
    .setDescription('API documentation for CrowdFunding')
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

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup(`api/docs`, app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
  });

  app.setGlobalPrefix('api');

  // Port configuration
  const port = configService.get<number>('port') || process.env.PORT || 3000;
  await app.listen(port);

  console.log(`Application is running on: http://localhost:${port}/api`);
  console.log(`Auth endpoints available at: http://localhost:${port}/api/auth`);
  console.log(
    `Users endpoints available at: http://localhost:${port}/api/users`,
  );
}

bootstrap().catch((error) => {
  console.error('Failed to start application:', error);
  process.exit(1);
});
