import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../enums/role.enum';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<{ user?: { roles?: UserRole[]; role?: UserRole } }>();
    const user = request.user;
    const userRoles: UserRole[] = Array.isArray(user?.roles)
      ? user.roles
      : user?.role
      ? [user.role]
      : [];

    if (userRoles.includes(UserRole.SUPERADMIN)) {
      return true;
    }

    if (!user || userRoles.length === 0) {
      return false;
    }

    return requiredRoles.some((role) => userRoles.includes(role));
  }
}
