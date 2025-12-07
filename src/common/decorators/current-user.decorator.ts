import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { JwtPayload } from '../interfaces/user.interface';

type CurrentUserField = 'sub' | 'email' | 'walletAddress' | 'roles';

export const CurrentUser = createParamDecorator(
  (data: CurrentUserField | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<{ user?: JwtPayload }>();
    const user = request.user;

    if (!user) {
      return undefined;
    }

    if (!data) {
      return user;
    }

    switch (data) {
      case 'sub':
        return user.sub;
      case 'email':
        return user.email;
      case 'walletAddress':
        return user.walletAddress;
      case 'roles':
        return user.roles;
      default:
        return undefined;
    }
  },
);
