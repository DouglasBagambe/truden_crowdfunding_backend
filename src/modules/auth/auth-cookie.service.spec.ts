import { ConfigService } from '@nestjs/config';
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
    const response = {
      cookie: jest.fn(),
      clearCookie: jest.fn(),
    } as any;
    const service = new AuthCookieService(config);

    service.setSession(response, {
      accessToken: 'access',
      refreshToken: 'refresh',
    });

    expect(response.cookie).toHaveBeenCalledWith(
      'keibo_access',
      'access',
      expect.objectContaining({ httpOnly: true, path: '/', sameSite: 'lax' }),
    );
    expect(response.cookie).toHaveBeenCalledWith(
      'keibo_refresh',
      'refresh',
      expect.objectContaining({ httpOnly: true, path: '/api/auth' }),
    );
  });

  it('clears the access cookie using the same route-visible path', () => {
    const response = {
      cookie: jest.fn(),
      clearCookie: jest.fn(),
    } as any;
    const service = new AuthCookieService(config);

    service.clearSession(response);

    expect(response.clearCookie).toHaveBeenCalledWith(
      'keibo_access',
      expect.objectContaining({ path: '/' }),
    );
  });
});
