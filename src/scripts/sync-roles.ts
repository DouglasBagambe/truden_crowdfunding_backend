import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { RolesService } from '../modules/roles/roles.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'error', 'warn'],
  });

  const rolesService = app.get(RolesService);
  await rolesService.ensureDefaultRoles();
  await rolesService.syncFromConfig();

  await app.close();
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Role sync failed', err);
  process.exit(1);
});
