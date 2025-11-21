import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { UserRole } from '../../../common/enums/role.enum';

type RequestWithUserRole = Request & { user?: { roles?: UserRole[] } };

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest<RequestWithUserRole>();
    const roles = user?.roles ?? [];

    if (roles.includes(UserRole.SUPERADMIN)) {
      return true;
    }

    if (!requiredRoles.some((role) => roles.includes(role))) {
      throw new ForbiddenException(
        `Requires roles: ${requiredRoles.join(', ')}`,
      );
    }

    return true;
  }
}
