import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Use this guard when authentication is optional.
 * If a valid JWT is present, req.user is populated.
 * If no token is present (or it is invalid), req.user is null and the request continues.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext) {
    return super.canActivate(context);
  }

  // Never throw — treat missing/invalid token as anonymous
  handleRequest(_err: any, user: any) {
    return user ?? null;
  }
}
