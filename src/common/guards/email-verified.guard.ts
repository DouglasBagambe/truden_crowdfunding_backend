import {
    Injectable,
    CanActivate,
    ExecutionContext,
    ForbiddenException,
    SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export const SKIP_EMAIL_VERIFICATION_KEY = 'skipEmailVerification';
export const SkipEmailVerification = () => SetMetadata(SKIP_EMAIL_VERIFICATION_KEY, true);

/**
 * Guard that blocks requests from users whose email is not verified.
 * Reads the `emailVerified` claim from the JWT payload (set in auth.service.ts → generateTokens).
 * No extra DB query needed.
 *
 * Skip for a specific route with: @SkipEmailVerification()
 */
@Injectable()
export class EmailVerifiedGuard implements CanActivate {
    constructor(private readonly reflector: Reflector) { }

    canActivate(context: ExecutionContext): boolean {
        // Allow if the route is decorated to skip this check
        const skip = this.reflector.getAllAndOverride<boolean>(SKIP_EMAIL_VERIFICATION_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);
        if (skip) return true;

        const request = context.switchToHttp().getRequest();
        const user = request.user;

        // If no JWT user, let JwtAuthGuard handle it
        if (!user) return true;

        // Check emailVerified claim injected into JWT at login time
        if (user.emailVerified === false) {
            throw new ForbiddenException(
                'Email not verified. Please verify your email address to perform this action.',
            );
        }

        return true;
    }
}
