import { GoneException, Injectable } from '@nestjs/common';
import { KeiboContractConfigService } from './keibo-contract-config.service';

export const KEIBO_LEGACY_ROUTE_DISABLED = 'KEIBO_LEGACY_ROUTE_DISABLED';

/**
 * Controller boundary for routes backed by the retired Mongo/legacy-contract
 * financial runtime. It must run before a controller delegates to any service.
 */
@Injectable()
export class KeiboLegacyRouteGuard {
  constructor(private readonly keiboConfig: KeiboContractConfigService) {}

  rejectInKeiboMode(): void {
    if (!this.keiboConfig.isKeiboRuntimeEnabled()) return;

    throw new GoneException({
      code: KEIBO_LEGACY_ROUTE_DISABLED,
      message: 'This legacy route is unavailable in KEIBO mode',
    });
  }
}
