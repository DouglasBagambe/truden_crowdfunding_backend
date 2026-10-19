import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { EmailVerifiedGuard } from './email-verified.guard';

describe('EmailVerifiedGuard', () => {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(false),
  } as unknown as Reflector;
  const guard = new EmailVerifiedGuard(reflector);
  const contextFor = (emailVerified: unknown) =>
    ({
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({ getRequest: () => ({ user: { emailVerified } }) }),
    }) as unknown as ExecutionContext;

  it('accepts explicitly verified accounts', () => {
    expect(guard.canActivate(contextFor(true))).toBe(true);
  });

  it.each([false, undefined, null, 'true'])(
    'rejects unverified or absent status %s',
    (status) => {
      expect(() => guard.canActivate(contextFor(status))).toThrow(
        ForbiddenException,
      );
    },
  );
});
