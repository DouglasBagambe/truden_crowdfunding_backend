/**
 * CLI Maintenance Script: Backfill ROI On-chain Provisioning
 *
 * Scans all ROI projects in APPROVED or FUNDING status that are missing a
 * valid projectOnchainId and provisions them on-chain.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register src/scripts/backfill-roi-provisioning.ts
 *   npx ts-node -r tsconfig-paths/register src/scripts/backfill-roi-provisioning.ts --dry-run
 *
 * Flags:
 *   --dry-run   Log which projects would be processed; make no chain transactions or DB writes.
 *
 * This script is idempotent: already-provisioned projects are skipped.
 */

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { ProjectsService } from '../modules/projects/projects.service';

const logger = new Logger('BackfillROIProvisioning');

async function bootstrap(): Promise<void> {
  const isDryRun = process.argv.includes('--dry-run');

  if (isDryRun) {
    logger.log('🔍 DRY-RUN mode — no transactions or DB writes will occur.');
  } else {
    logger.log('🚀 LIVE mode — will provision on-chain and update DB.');
  }

  const app = await NestFactory.createApplicationContext(AppModule);
  const projectsService = app.get(ProjectsService);

  try {
    if (isDryRun) {
      // In dry-run we call the service that only reads from the DB
      const result = await (projectsService as any).projectsRepo.query(
        {
          projectType: 'ROI',
          status: { $in: ['APPROVED', 'FUNDING'] },
          $or: [
            { projectOnchainId: { $exists: false } },
            { projectOnchainId: null },
            { projectOnchainId: '' },
            { projectOnchainId: '0' },
          ],
        },
        500,
        0,
      ) as Array<{ _id: unknown; id?: unknown; name?: string; status: string }>;

      logger.log(`\n📋 DRY-RUN results: ${result.length} project(s) would be processed\n`);
      for (const p of result) {
        const pid = String(p._id || p.id);
        logger.log(`  • [${p.status}] ${p.name || 'unnamed'} (${pid})`);
      }

      if (result.length === 0) {
        logger.log('✅ Nothing to backfill — all ROI projects are already provisioned.');
      }
    } else {
      const report = await projectsService.backfillRoiProvisioning();

      logger.log(`\n📊 Backfill Report:`);
      logger.log(`   Total candidates : ${report.total}`);
      logger.log(`   Skipped          : ${report.skipped}`);
      logger.log(`   Provisioned      : ${report.provisioned}`);
      logger.log(`   Failed           : ${report.failed}`);
      logger.log('');

      for (const entry of report.results) {
        if (entry.result === 'PROVISIONED') {
          logger.log(`  ✅ PROVISIONED  ${entry.name} (${entry.projectId}) → onchainId=${entry.projectOnchainId}`);
        } else if (entry.result === 'SKIPPED') {
          logger.log(`  ⏭️  SKIPPED     ${entry.name} (${entry.projectId}) — already has onchainId=${entry.projectOnchainId}`);
        } else {
          logger.error(`  ❌ FAILED      ${entry.name} (${entry.projectId}) — ${entry.error}`);
        }
      }

      if (report.failed > 0) {
        logger.error(`\n⚠️  ${report.failed} project(s) failed. Check logs above and retry with the admin repair endpoint.`);
        process.exitCode = 1;
      } else {
        logger.log('\n✅ Backfill complete — no failures.');
      }
    }
  } finally {
    await app.close();
  }
}

bootstrap().catch((err: unknown) => {
  logger.error('Fatal error during backfill script', err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
