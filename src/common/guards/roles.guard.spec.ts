import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../enums/role.enum';
import { RolesGuard } from './roles.guard';

const contextFor = (roles?: UserRole[]) =>
  ({
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: () => ({
      getRequest: () => ({ user: roles ? { roles } : undefined }),
    }),
  }) as unknown as ExecutionContext;

describe('RolesGuard authorization boundaries', () => {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue([UserRole.ADMIN]),
  } as unknown as Reflector;
  const guard = new RolesGuard(reflector);

  afterEach(() => delete process.env.KYC_BYPASS);

  it.each([UserRole.INVESTOR, UserRole.INNOVATOR, UserRole.APPROVER])(
    'denies %s access to administrator routes',
    (role) => {
      expect(guard.canActivate(contextFor([role]))).toBe(false);
    },
  );

  it('denies unauthenticated access even when a KYC test bypass is set', () => {
    process.env.KYC_BYPASS = 'true';
    expect(guard.canActivate(contextFor())).toBe(false);
  });

  it('allows administrators and superadministrators', () => {
    expect(guard.canActivate(contextFor([UserRole.ADMIN]))).toBe(true);
    expect(guard.canActivate(contextFor([UserRole.SUPERADMIN]))).toBe(true);
  });
});
