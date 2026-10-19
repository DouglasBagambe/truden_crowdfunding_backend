import {
  CanActivate,
  ExecutionContext,
  GoneException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { investmentsEnabled } from '../utils/product-features.util';

@Injectable()
export class InvestmentLaunchGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    if (investmentsEnabled(this.config)) return true;
    const { path = '' } = context
      .switchToHttp()
      .getRequest<{ path?: string }>();
    const route = path.replace(/^\/api(?=\/)/, '');
    if (
      /^\/(investments|nfts?|marketplace|deal-room)(\/|$)/i.test(route) ||
      /^\/financial\/(onchain-contributions|receipts)(\/|$)/i.test(route) ||
      /^\/projects\/[^/]+\/provisioning(\/|$)/i.test(route)
    ) {
      throw new GoneException({
        code: 'INVESTMENTS_UNAVAILABLE',
        message: 'Investments are unavailable during the charity launch.',
      });
    }
    return true;
  }
}
