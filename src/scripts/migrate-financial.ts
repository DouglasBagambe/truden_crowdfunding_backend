import { ConfigService } from '@nestjs/config';
import { FinancialDatabase } from '../modules/financial/financial.database';
import { FinancialService } from '../modules/financial/financial.service';
import type { ProjectsService } from '../modules/projects/projects.service';

async function migrateFinancialSchema(): Promise<void> {
  const config = new ConfigService();
  const database = new FinancialDatabase(config);
  const projectsService = {
    ensureProjectCanReceiveDonation: async () => undefined,
  } as unknown as ProjectsService;
  const financial = new FinancialService(database, projectsService);

  try {
    await financial.initializeSchema();
    console.log('Financial schema migration completed');
  } finally {
    await database.close();
  }
}

migrateFinancialSchema().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown error';
  console.error(`Financial schema migration failed: ${message}`);
  process.exit(1);
});
