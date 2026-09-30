import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { Server } from 'http';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import appConfig from '../../config/app.config';
import { CsrfGuard } from '../../common/guards/csrf.guard';
import { AuthController } from './auth.controller';
import { AuthCookieService } from './auth-cookie.service';
import { AuthService } from './auth.service';

const origin = 'https://keibo01.vercel.app';

describe.each(['test', 'production'])(
  'HTTPS %s CSRF authentication',
  (nodeEnv) => {
    let app: INestApplication;
    let server: Server;
    const login = jest.fn().mockResolvedValue({
      accessToken: 'access',
      refreshToken: 'refresh',
      user: { id: 'user' },
    });
    beforeAll(async () => {
      const values: Record<string, string> = {
        NODE_ENV: nodeEnv,
        CSRF_SECRET: 'csrf-secret-only-for-http-tests',
        COOKIE_SECURE: 'true',
        COOKIE_SAME_SITE: 'none',
        COOKIE_DOMAIN: '',
        FRONTEND_URL: origin,
        CORS_ORIGIN: origin,
      };
      const fixture = await Test.createTestingModule({
        controllers: [AuthController],
        providers: [
          AuthCookieService,
          {
            provide: ConfigService,
            useValue: { get: (key: string) => values[key] },
          },
          { provide: AuthService, useValue: { login } },
          { provide: APP_GUARD, useClass: CsrfGuard },
        ],
      }).compile();
      app = fixture.createNestApplication();
      app.use(cookieParser());
      const previousOrigin = process.env.CORS_ORIGIN;
      process.env.CORS_ORIGIN = origin;
      app.enableCors({ origin: appConfig().cors.origin, credentials: true });
      if (previousOrigin === undefined) delete process.env.CORS_ORIGIN;
      else process.env.CORS_ORIGIN = previousOrigin;
      app.setGlobalPrefix('api');
      await app.init();
      server = app.getHttpServer() as Server;
    });
    afterAll(async () => {
      await app.close();
    });
    beforeEach(() => login.mockClear());

    async function bootstrap() {
      const response = await request(server)
        .get('/api/auth/csrf')
        .set('Origin', origin)
        .expect(200);
      const body = response.body as { csrfToken: string };
      const cookies = response.headers['set-cookie'] as unknown as string[];
      const csrfCookie = cookies.find((value) =>
        value.startsWith(`keibo_csrf=${body.csrfToken};`),
      );
      if (!csrfCookie) throw new Error('Missing CSRF cookie');
      return { response, token: body.csrfToken, cookie: csrfCookie };
    }
    it('issues a route-readable host-only secure CSRF cookie and accepts the UAT origin', async () => {
      const { response, token, cookie } = await bootstrap();
      expect(cookie).toContain(`keibo_csrf=${token};`);
      expect(cookie).toContain('Path=/;');
      expect(cookie).toContain('Secure');
      expect(cookie).toContain('SameSite=None');
      expect(cookie).not.toContain('Domain=');
      expect(cookie).not.toContain('HttpOnly');
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['access-control-allow-origin']).toBe(origin);
      expect(response.headers['access-control-allow-credentials']).toBe('true');
    });
    it('logs in with a matching signed cookie/header and issues secure session cookies', async () => {
      const { token, cookie } = await bootstrap();
      const response = await request(server)
        .post('/api/auth/login')
        .set('Origin', origin)
        .set('Cookie', cookie.split(';')[0])
        .set('X-CSRF-Token', token)
        .send({ email: 'user@example.test', password: 'password' })
        .expect(200);
      expect(login).toHaveBeenCalledTimes(1);
      const cookies = response.headers['set-cookie'] as unknown as string[];
      expect(
        cookies.some(
          (value) =>
            value.startsWith('keibo_access=access;') &&
            value.includes('HttpOnly') &&
            value.includes('Secure') &&
            value.includes('Path=/;'),
        ),
      ).toBe(true);
      expect(
        cookies.some(
          (value) =>
            value.startsWith('keibo_refresh=refresh;') &&
            value.includes('Path=/api/auth;') &&
            value.includes('HttpOnly'),
        ),
      ).toBe(true);
    });
    it('rejects missing CSRF before credentials are processed', async () => {
      await request(server).post('/api/auth/login').send({}).expect(403);
      expect(login).not.toHaveBeenCalled();
    });
    it('rejects mismatched CSRF before credentials are processed', async () => {
      const { token, cookie } = await bootstrap();
      await request(server)
        .post('/api/auth/login')
        .set('Cookie', cookie.split(';')[0])
        .set('X-CSRF-Token', `${token}tampered`)
        .send({})
        .expect(403);
      expect(login).not.toHaveBeenCalled();
    });
  },
);
