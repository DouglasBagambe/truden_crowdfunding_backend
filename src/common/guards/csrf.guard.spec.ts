import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { createHmac } from 'crypto';
import type { ExecutionContext } from '@nestjs/common';
import { CsrfGuard } from './csrf.guard';

const secret = 'csrf-secret-used-only-for-a-unit-test';

function contextFor(method: string, cookie?: string, header?: string) {
  const request = {
    method,
    cookies: cookie ? { keibo_csrf: cookie } : {},
    header: jest.fn().mockReturnValue(header),
  };
  return {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('CsrfGuard', () => {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(false),
  } as unknown as Reflector;
  const config = {
    get: jest.fn().mockReturnValue(secret),
  } as unknown as ConfigService;
  const guard = new CsrfGuard(reflector, config);

  it('allows safe methods without a token', () => {
    expect(guard.canActivate(contextFor('GET'))).toBe(true);
  });

  it('allows an unsafe request only with matching signed tokens', () => {
    const random = 'random-value';
    const signature = createHmac('sha256', secret)
      .update(random)
      .digest('base64url');
    const token = `${random}.${signature}`;
    expect(guard.canActivate(contextFor('POST', token, token))).toBe(true);
  });

  it.each([
    ['missing header', 'random.signature', undefined],
    ['mismatched header', 'random.signature', 'different.signature'],
    ['invalid signature', 'random.invalid', 'random.invalid'],
  ])('rejects %s', (_case, cookie, header) => {
    expect(() => guard.canActivate(contextFor('POST', cookie, header))).toThrow(
      ForbiddenException,
    );
  });
});
