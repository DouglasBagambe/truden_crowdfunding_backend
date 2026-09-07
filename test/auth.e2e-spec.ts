import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import type { Server } from 'node:http';
import { Model } from 'mongoose';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server-core';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { decode } from 'jsonwebtoken';
import { createHash } from 'crypto';
import { AppModule } from '../src/app.module';
import { Permission } from '../src/common/enums/permission.enum';
import { UserRole } from '../src/common/enums/role.enum';
import { User, UserDocument } from '../src/modules/users/schemas/user.schema';
import {
  RefreshToken,
  RefreshTokenDocument,
} from '../src/modules/auth/schemas/refresh-token.schema';

jest.setTimeout(120000);

type AuthUser = {
  email?: string;
  roles: UserRole[];
  permissions: Permission[];
  profile: {
    displayName?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type SessionResponse = {
  user?: AuthUser;
  permissions?: Permission[];
  accessToken?: unknown;
  refreshToken?: unknown;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};

const isAuthUser = (value: unknown): value is AuthUser => {
  if (!value || typeof value !== 'object') return false;
  const { roles, permissions } = value as Record<string, unknown>;
  return Array.isArray(roles) && Array.isArray(permissions);
};

function cookiePair(setCookies: string[], name: string): string {
  const cookie = setCookies.find((value) => value.startsWith(`${name}=`));
  if (!cookie) throw new Error(`Expected ${name} cookie`);
  return cookie.split(';', 1)[0];
}

function validateExternalE2eMongoUri(value?: string): string | undefined {
  const uri = value?.trim();
  if (!uri) return undefined;
  const databaseName = new URL(uri).pathname
    .replace(/^\//, '')
    .split('?', 1)[0];
  if (databaseName !== 'keibo_e2e') {
    throw new Error(
      'E2E_MONGO_URI must target the dedicated keibo_e2e database',
    );
  }
  return uri;
}

describe('Auth integration (e2e)', () => {
  let app: INestApplication;
  let httpServer: Server;
  let mongo: MongoMemoryServer | null = null;
  let userModel: Model<UserDocument>;
  let refreshTokenModel: Model<RefreshTokenDocument>;
  let sequence = 0;

  const password = 'P@ssw0rd123';

  beforeAll(async () => {
    const externalMongoUri = validateExternalE2eMongoUri(
      process.env.E2E_MONGO_URI,
    );
    if (!externalMongoUri) {
      mongo = await MongoMemoryServer.create({
        binary: { version: '7.0.14' },
      });
    }

    process.env.NODE_ENV = 'test';
    const mongoUri = externalMongoUri || mongo?.getUri('keibo_e2e');
    if (!mongoUri) throw new Error('Disposable e2e database did not start');
    process.env.MONGO_URI = mongoUri;
    process.env.JWT_SECRET = 'test-jwt-secret-for-cookie-e2e-only';
    process.env.REFRESH_TOKEN_SECRET =
      'test-refresh-secret-for-cookie-e2e-only';
    process.env.PASSWORD_RESET_SECRET = 'test-reset-secret-for-cookie-e2e-only';
    process.env.CSRF_SECRET = 'test-csrf-secret-for-cookie-e2e-only';
    process.env.JWT_ISSUER = 'keibo-e2e';
    process.env.JWT_AUDIENCE = 'keibo-e2e-client';
    process.env.AUTH_EMAIL_BYPASS = 'true';
    process.env.COOKIE_SECURE = 'false';
    process.env.COOKIE_SAME_SITE = 'lax';
    delete process.env.COOKIE_DOMAIN;
    process.env.BACKEND_URL = 'http://localhost:3000';
    process.env.FRONTEND_URL = 'http://localhost:3001';
    process.env.SIWE_DOMAIN = 'localhost:3001';
    process.env.SIWE_URI = 'http://localhost:3001';
    process.env.SIWE_CHAIN_IDS = '31337';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.setGlobalPrefix('api');
    await app.init();

    httpServer = app.getHttpServer() as Server;
    userModel = app.get<Model<UserDocument>>(getModelToken(User.name));
    refreshTokenModel = app.get<Model<RefreshTokenDocument>>(
      getModelToken(RefreshToken.name),
    );
  });

  afterAll(async () => {
    if (app) await app.close();
    await mongoose.disconnect();
    if (mongo) await mongo.stop();
  });

  afterEach(async () => {
    if (userModel) await userModel.deleteMany({});
    if (refreshTokenModel) await refreshTokenModel.deleteMany({});
  });

  const nextPayload = () => {
    sequence += 1;
    return {
      email: `alice-${sequence}@example.com`,
      password,
      firstName: 'Alice',
      lastName: 'Tester',
    };
  };

  async function csrf(agent: ReturnType<typeof request.agent>) {
    const response = await agent.get('/api/auth/csrf').expect(200);
    const token = asRecord(response.body as unknown).csrfToken;
    expect(typeof token).toBe('string');
    if (typeof token !== 'string') throw new Error('Missing CSRF token');
    return token;
  }

  async function register(agent: ReturnType<typeof request.agent>) {
    const payload = nextPayload();
    const csrfToken = await csrf(agent);
    const response = await agent
      .post('/api/auth/register')
      .set('X-CSRF-Token', csrfToken)
      .send(payload)
      .expect(201);
    return { payload, response };
  }

  it('registers with HttpOnly session cookies and no token-bearing JSON', async () => {
    const agent = request.agent(httpServer);
    const { payload, response } = await register(agent);
    const body = response.body as SessionResponse;
    expect(body.accessToken).toBeUndefined();
    expect(body.refreshToken).toBeUndefined();
    expect(body.user?.email).toBe(payload.email);
    expect(body.user?.roles).toEqual([UserRole.INVESTOR]);
    expect(body.user?.permissions).toContain(Permission.INVEST);
    expect(body.user?.profile.displayName).toBe('Alice Tester');

    const cookies = response.headers['set-cookie'] as unknown as string[];
    expect(
      cookies.some(
        (value) =>
          value.startsWith('keibo_access=') && value.includes('HttpOnly'),
      ),
    ).toBe(true);
    expect(
      cookies.some(
        (value) =>
          value.startsWith('keibo_refresh=') && value.includes('HttpOnly'),
      ),
    ).toBe(true);
    expect(
      cookies.some(
        (value) =>
          value.startsWith('keibo_csrf=') && !value.includes('HttpOnly'),
      ),
    ).toBe(true);
  });

  it('requires a valid CSRF token on unsafe cookie-session requests', async () => {
    const agent = request.agent(httpServer);
    const payload = nextPayload();
    await agent.post('/api/auth/register').send(payload).expect(403);

    const csrfToken = await csrf(agent);
    await agent
      .post('/api/auth/register')
      .set('X-CSRF-Token', `${csrfToken}tampered`)
      .send(payload)
      .expect(403);
  });

  it('logs in and reads the profile through cookies', async () => {
    const registrationAgent = request.agent(httpServer);
    const { payload } = await register(registrationAgent);

    const loginAgent = request.agent(httpServer);
    const csrfToken = await csrf(loginAgent);
    const login = await loginAgent
      .post('/api/auth/login')
      .set('X-CSRF-Token', csrfToken)
      .send({ email: payload.email, password })
      .expect(200);
    expect((login.body as SessionResponse).accessToken).toBeUndefined();

    const profile = await loginAgent.get('/api/auth/profile').expect(200);
    const profileBody: unknown = profile.body;
    expect(isAuthUser(profileBody)).toBe(true);
    if (!isAuthUser(profileBody)) throw new Error('Invalid profile response');
    expect(profileBody.email).toBe(payload.email);
  });

  it('rejects invalid login attempts without exposing session details', async () => {
    const agent = request.agent(httpServer);
    const { payload } = await register(agent);
    const csrfToken = await csrf(agent);
    const response = await agent
      .post('/api/auth/login')
      .set('X-CSRF-Token', csrfToken)
      .send({ email: payload.email, password: 'wrong-password' })
      .expect(401);
    const body = response.body as SessionResponse;
    expect(body.accessToken).toBeUndefined();
    expect(body.refreshToken).toBeUndefined();
  });

  it('rotates refresh cookies and rejects replay of the used token', async () => {
    const agent = request.agent(httpServer);
    const { response } = await register(agent);
    const registrationCookies = response.headers[
      'set-cookie'
    ] as unknown as string[];
    const oldRefresh = cookiePair(registrationCookies, 'keibo_refresh');
    const oldRefreshValue = oldRefresh.slice('keibo_refresh='.length);
    const oldCsrf = cookiePair(registrationCookies, 'keibo_csrf');
    const oldCsrfToken = oldCsrf.slice('keibo_csrf='.length);
    const decoded = decode(oldRefreshValue) as {
      jti?: string;
      sub?: string;
      typ?: string;
    } | null;
    expect(decoded).toMatchObject({ typ: 'refresh' });
    expect(await refreshTokenModel.countDocuments({})).toBe(1);
    const storedRefresh = await refreshTokenModel.findOne({}).lean();
    expect(storedRefresh).toEqual(
      expect.objectContaining({
        jti: decoded?.jti,
        tokenHash: createHash('sha256').update(oldRefreshValue).digest('hex'),
      }),
    );
    expect(String(storedRefresh?.userId)).toBe(decoded?.sub);

    const firstRefresh = await request(httpServer)
      .post('/api/auth/refresh')
      .set('Cookie', `${oldRefresh}; ${oldCsrf}`)
      .set('X-CSRF-Token', oldCsrfToken)
      .expect(200);
    expect((firstRefresh.body as SessionResponse).accessToken).toBeUndefined();
    const rotatedCookies = firstRefresh.headers[
      'set-cookie'
    ] as unknown as string[];
    expect(cookiePair(rotatedCookies, 'keibo_refresh')).not.toBe(oldRefresh);

    await request(httpServer)
      .post('/api/auth/refresh')
      .set('Cookie', `${oldRefresh}; ${oldCsrf}`)
      .set('X-CSRF-Token', oldCsrfToken)
      .expect(401);
  });

  it('revokes all sessions and clears browser cookies', async () => {
    const agent = request.agent(httpServer);
    await register(agent);
    const csrfToken = await csrf(agent);
    const logout = await agent
      .post('/api/auth/logout-all')
      .set('X-CSRF-Token', csrfToken)
      .expect(200);
    const cookies = logout.headers['set-cookie'] as unknown as string[];
    expect(cookies.some((value) => value.startsWith('keibo_access=;'))).toBe(
      true,
    );
    await agent.get('/api/auth/profile').expect(401);
  });
});
