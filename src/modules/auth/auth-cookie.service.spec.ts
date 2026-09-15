import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { AuthCookieService } from './auth-cookie.service';

describe('AuthCookieService', () => {
  const config = {
    get: jest.fn((key: string) => {
      const values: Record<string, string> = {
        CSRF_SECRET: 'csrf-test-secret',
        JWT_EXPIRY: '15m',
        REFRESH_TOKEN_EXPIRY: '7d',
        NODE_ENV: 'test',
      };
      return values[key];
    }),
  } as unknown as ConfigService;

  beforeEach(() => jest.clearAllMocks());

  it('makes the access cookie available to protected frontend routes', () => {
    const cookie = jest.fn();
    const clearCookie = jest.fn();
    const response = {
      cookie,
      clearCookie,
    } as unknown as Response;
    const service = new AuthCookieService(config);

    service.setSession(response, {
      accessToken: 'access',
      refreshToken: 'refresh',
    });

    expect(clearCookie).toHaveBeenCalledWith(
      'keibo_access',
      expect.objectContaining({ path: '/api' }),
    );
    expect(cookie).toHaveBeenCalledWith(
      'keibo_access',
      'access',
      expect.objectContaining({ httpOnly: true, path: '/', sameSite: 'lax' }),
    );
    expect(cookie).toHaveBeenCalledWith(
      'keibo_refresh',
      'refresh',
      expect.objectContaining({ httpOnly: true, path: '/api/auth' }),
    );
  });

  it('clears access cookies at both the route-visible and legacy API paths', () => {
    const clearCookie = jest.fn();
    const response = {
      cookie: jest.fn(),
      clearCookie,
    } as unknown as Response;
    const service = new AuthCookieService(config);

    service.clearSession(response);

    expect(clearCookie).toHaveBeenCalledWith(
      'keibo_access',
      expect.objectContaining({ path: '/' }),
    );
    expect(clearCookie).toHaveBeenCalledWith(
      'keibo_access',
      expect.objectContaining({ path: '/api' }),
    );
  });
});
