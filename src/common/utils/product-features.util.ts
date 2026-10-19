import { ConfigService } from '@nestjs/config';

/** Off by default for the charity-first launch, independent of ROI allowlists. */
export function investmentsEnabled(config?: ConfigService): boolean {
  return (
    String(
      config?.get('INVESTMENTS_ENABLED') ??
        process.env.INVESTMENTS_ENABLED ??
        '',
    ).toLowerCase() === 'true'
  );
}
