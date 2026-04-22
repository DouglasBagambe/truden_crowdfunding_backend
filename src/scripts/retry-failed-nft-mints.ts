/**
 * CLI Maintenance Script: Retry Failed NFT Mints
 *
 * Scans all investment records with mintStatus=FAILED or mintStatus=PENDING
 * that have a walletAddress and attempts to mint NFTs for each one.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register src/scripts/retry-failed-nft-mints.ts
 *   npx ts-node -r tsconfig-paths/register src/scripts/retry-failed-nft-mints.ts --dry-run
 *   npx ts-node -r tsconfig-paths/register src/scripts/retry-failed-nft-mints.ts --id <investmentId>
 *
 * Flags:
 *   --dry-run         Log which investments would be retried; no transactions or DB writes.
 *   --id <id>         Retry a single investment by ID instead of the full batch.
 *
 * This script is idempotent: already-MINTED investments are skipped.
 * Pre-requisite: all projects must be provisioned on-chain first.
 *   Run backfill-roi-provisioning.ts if needed.
 */

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { InvestmentsService } from '../modules/investments/services/investments.service';
import { MintStatus } from '../modules/investments/schemas/investment.schema';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Investment } from '../modules/investments/schemas/investment.schema';

const logger = new Logger('RetryFailedNftMints');

async function bootstrap(): Promise<void> {
  const args = process.argv.slice(2);
  const isDryRun = args.includes('--dry-run');
  const idIndex = args.indexOf('--id');
  const singleId = idIndex !== -1 ? args[idIndex + 1] : undefined;

  if (isDryRun) {
    logger.log('🔍 DRY-RUN mode — no transactions or DB writes will occur.');
  } else if (singleId) {
    logger.log(`🎯 SINGLE mode — retrying investment ${singleId}`);
  } else {
    logger.log('🚀 BATCH mode — retrying all FAILED/PENDING NFT mints.');
  }

  const app = await NestFactory.createApplicationContext(AppModule);
  const investmentsService = app.get(InvestmentsService);

  try {
    if (isDryRun) {
      // In dry-run mode, just list candidates from the DB without minting
      const investmentModel = app.get<Model<any>>(`${Investment.name}Model`);
      const candidates = await investmentModel
        .find({
          mintStatus: { $in: [MintStatus.FAILED, MintStatus.PENDING] },
          walletAddress: { $ne: null, $exists: true },
          nftMinted: false,
        })
        .limit(500)
        .lean()
        .exec();

      logger.log(`\n📋 DRY-RUN: ${candidates.length} investment(s) eligible for mint retry\n`);
      for (const inv of candidates) {
        logger.log(
          `  • [${inv.mintStatus}] investment=${inv._id}  project=${inv.projectId}  wallet=${inv.walletAddress}  mintError="${inv.mintError || 'none'}"`,
        );
      }
      if (candidates.length === 0) {
        logger.log('✅ Nothing to retry — all investments are already MINTED or BYPASSED.');
      }
      return;
    }

    if (singleId) {
      const result = await investmentsService.retryFailedNftMint(singleId);
      if (result.result === 'MINTED') {
        logger.log(`✅ MINTED  investment=${result.investmentId}  txHash=${result.nftTxHash}`);
      } else if (result.result === 'SKIPPED') {
        logger.log(`⏭️  SKIPPED  investment=${result.investmentId} — ${result.reason}`);
      } else {
        logger.error(`❌ FAILED   investment=${result.investmentId} — ${result.reason}`);
        process.exitCode = 1;
      }
      return;
    }

    // Batch retry
    const report = await investmentsService.retryAllFailedNftMints();

    logger.log(`\n📊 Retry Report:`);
    logger.log(`   Total candidates : ${report.total}`);
    logger.log(`   Minted           : ${report.minted}`);
    logger.log(`   Skipped          : ${report.skipped}`);
    logger.log(`   Failed           : ${report.failed}`);
    logger.log('');

    for (const entry of report.results) {
      if (entry.result === 'MINTED') {
        logger.log(`  ✅ MINTED   ${entry.investmentId} → txHash=${entry.nftTxHash}`);
      } else if (entry.result === 'SKIPPED') {
        logger.log(`  ⏭️  SKIPPED  ${entry.investmentId} — ${entry.reason}`);
      } else {
        logger.error(`  ❌ FAILED   ${entry.investmentId} — ${entry.reason}`);
      }
    }

    if (report.failed > 0) {
      logger.error(
        `\n⚠️  ${report.failed} investment(s) failed. Check logs above.\n` +
        'Ensure projects are provisioned first: run backfill-roi-provisioning.ts',
      );
      process.exitCode = 1;
    } else {
      logger.log('\n✅ All retries complete — no failures.');
    }
  } finally {
    await app.close();
  }
}

bootstrap().catch((err: unknown) => {
  logger.error('Fatal error during retry script', err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
