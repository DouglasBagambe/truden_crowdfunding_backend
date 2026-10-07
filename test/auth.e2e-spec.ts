import {
  Project,
  ProjectDocument,
} from '../src/modules/projects/schemas/project.schema';
import { ProjectType } from '../src/common/enums/project-type.enum';
import { ProjectStatus } from '../src/common/enums/project-status.enum';
import { AuthService } from '../src/modules/auth/auth.service';
import { KycService } from '../src/modules/kyc/kyc.service';
import {
  KycProfile,
  KycProfileDocument,
} from '../src/modules/kyc/schemas/kyc-profile.schema';
import { KycApplicationStatus } from '../src/modules/kyc/interfaces/kyc.interface';
import { KYCStatus } from '../src/common/enums/role.enum';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import type { Server } from 'node:http';
import { Model } from 'mongoose';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server-core';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { decode, sign } from 'jsonwebtoken';
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
  const cookie = setCookies.find(
    (value) => value.startsWith(`${name}=`) && !value.startsWith(`${name}=;`),
  );
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
          /^keibo_access=[^;]+;/.test(value) &&
          value.includes('HttpOnly') &&
          value.includes('Path=/;'),
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
    expect(
      cookies.some(
        (value) =>
          value.startsWith('keibo_access=;') && value.includes('Path=/;'),
      ),
    ).toBe(true);
    expect(
      cookies.some(
        (value) =>
          value.startsWith('keibo_access=;') && value.includes('Path=/api;'),
      ),
    ).toBe(true);
    await agent.get('/api/auth/profile').expect(401);
  });
  it('uses the KYC application for profile, identity, admin and eligibility despite a stale verified user flag', async () => {
    const agent = request.agent(httpServer);
    const { payload } = await register(agent);
    const user = await userModel.findOne({ email: payload.email }).orFail();
    await userModel.updateOne(
      { _id: user._id },
      {
        $set: {
          kycStatus: KYCStatus.VERIFIED,
          'kyc.status': KYCStatus.VERIFIED,
        },
      },
    );
    const profiles = app.get<Model<KycProfileDocument>>(
      getModelToken(KycProfile.name),
    );
    const application = await profiles.findOne({ userId: user._id }).orFail();
    expect(application.status).toBe(KycApplicationStatus.UNVERIFIED);
    const profile = await agent.get('/api/auth/profile').expect(200);
    expect(asRecord(profile.body as unknown).kycStatus).toBe(
      KYCStatus.NOT_VERIFIED,
    );
    const identity = await agent.get('/api/kyc/profile').expect(200);
    expect(asRecord(identity.body as unknown)).toMatchObject({
      status: 'UNVERIFIED',
      userKycStatus: KYCStatus.NOT_VERIFIED,
      submittedAt: null,
      documents: [],
    });
    const kyc = app.get(KycService);
    expect(await kyc.adminGetProfile(String(application._id))).toMatchObject({
      status: 'UNVERIFIED',
      userKycStatus: KYCStatus.NOT_VERIFIED,
    });
    await expect(kyc.requireVerified(String(user._id))).rejects.toThrow(
      'complete identity verification',
    );
  });

  it('returns safe forgot-password responses and validates expiring, single-use reset tokens', async () => {
    const agent = request.agent(httpServer);
    const { payload } = await register(agent);
    const service = app.get(AuthService);
    const tokenService = service as unknown as {
      sendPasswordResetEmail(email: string, token: string): Promise<boolean>;
    };
    let resetToken = '';
    const delivery = jest
      .spyOn(tokenService, 'sendPasswordResetEmail')
      .mockImplementation((_email, token) => {
        resetToken = token;
        return Promise.resolve(true);
      });
    try {
      const csrfToken = await csrf(agent);
      const forgot = await agent
        .post('/api/auth/forgot-password')
        .set('X-CSRF-Token', csrfToken)
        .send({ email: payload.email })
        .expect(200);
      expect(asRecord(forgot.body as unknown)).toEqual({
        message: 'If an account exists, a reset email will be sent.',
      });
      expect(resetToken).not.toBe('');
      expect(JSON.stringify(decode(resetToken))).not.toContain(password);
      await agent
        .post('/api/auth/reset-password')
        .set('X-CSRF-Token', csrfToken)
        .send({ token: 'invalid', newPassword: 'N3wPassword!123' })
        .expect(401);
      const expired = sign(
        {
          sub: String(
            (await userModel.findOne({ email: payload.email }).orFail())._id,
          ),
          typ: 'password-reset',
          passwordVersion: 0,
        },
        app.get(ConfigService).getOrThrow<string>('PASSWORD_RESET_SECRET'),
        {
          expiresIn: -1,
          issuer: app.get(ConfigService).get<string>('JWT_ISSUER'),
          audience: app.get(ConfigService).get<string>('JWT_AUDIENCE'),
        },
      );
      await agent
        .post('/api/auth/reset-password')
        .set('X-CSRF-Token', csrfToken)
        .send({ token: expired, newPassword: 'N3wPassword!123' })
        .expect(400);
      await agent
        .post('/api/auth/reset-password')
        .set('X-CSRF-Token', csrfToken)
        .send({ token: resetToken, newPassword: 'N3wPassword!123' })
        .expect(200);
      await agent
        .post('/api/auth/reset-password')
        .set('X-CSRF-Token', csrfToken)
        .send({ token: resetToken, newPassword: 'N3wPassword!123' })
        .expect(401);
      const loginAgent = request.agent(httpServer);
      const loginCsrf = await csrf(loginAgent);
      await loginAgent
        .post('/api/auth/login')
        .set('X-CSRF-Token', loginCsrf)
        .send({ email: payload.email, password })
        .expect(401);
      await loginAgent
        .post('/api/auth/login')
        .set('X-CSRF-Token', loginCsrf)
        .send({ email: payload.email, password: 'N3wPassword!123' })
        .expect(200);
    } finally {
      delivery.mockRestore();
    }
  });
  it('persists authenticated saved campaigns and keeps users isolated', async () => {
    const agent = request.agent(httpServer);
    const { payload } = await register(agent);
    const creator = await userModel.findOne({ email: payload.email }).orFail();
    const projects = app.get<Model<ProjectDocument>>(
      getModelToken(Project.name),
    );
    const project = await projects.create({
      name: 'Saved Test',
      projectType: ProjectType.CHARITY,
      status: ProjectStatus.FUNDING,
      creatorId: String(creator._id),
      targetAmount: 100,
      summary: 'Test',
      story: 'Test',
      country: 'UG',
      beneficiary: 'Test',
      currency: 'UGX',
      paymentMethod: 'BANK',
      category: 'ngo',
    });
    const path = `/api/projects/${String(project._id)}/saved`;
    const token = await csrf(agent);
    expect(
      asRecord((await agent.get(path).expect(200)).body as unknown).saved,
    ).toBe(false);
    await agent.put(path).set('X-CSRF-Token', token).expect(200);
    await agent.put(path).set('X-CSRF-Token', token).expect(200);
    expect(
      asRecord((await agent.get(path).expect(200)).body as unknown).saved,
    ).toBe(true);
    const another = request.agent(httpServer);
    await register(another);
    expect(
      asRecord((await another.get(path).expect(200)).body as unknown).saved,
    ).toBe(false);
    await request(httpServer).get(path).expect(401);
    await agent.delete(path).set('X-CSRF-Token', token).expect(200);
    expect(
      asRecord((await agent.get(path).expect(200)).body as unknown).saved,
    ).toBe(false);
  });
  it('public DTOs hide creator email and partial search, validated sort and pagination work against Mongo', async () => {
    const agent = request.agent(httpServer);
    const { payload } = await register(agent);
    const creator = await userModel.findOne({ email: payload.email }).orFail();
    const projects = app.get<Model<ProjectDocument>>(
      getModelToken(Project.name),
    );
    await projects.deleteMany({});
    const base = {
      projectType: ProjectType.CHARITY,
      status: ProjectStatus.FUNDING,
      creatorId: String(creator._id),
      targetAmount: 100,
      summary: 'Test',
      story: 'Test',
      country: 'UG',
      beneficiary: 'Test',
      currency: 'UGX',
      paymentMethod: 'BANK',
      category: 'ngo',
    };
    const first = await projects.create({
      ...base,
      name: 'Query Test Alpha',
      raisedAmount: 10,
      fundingEndDate: new Date(Date.now() + 86400000),
    });
    const second = await projects.create({
      ...base,
      name: 'Query Test Beta',
      raisedAmount: 50,
      fundingEndDate: new Date(Date.now() + 172800000),
    });
    for (const search of ['Query Test Alpha', 'Query Tes', 'query tes']) {
      const response = await request(httpServer)
        .get('/api/projects')
        .query({ search })
        .expect(200);
      expect(asRecord(response.body as unknown).total).toBe(
        search.endsWith('Alpha') ? 1 : 2,
      );
      expect(JSON.stringify(response.body)).not.toContain(payload.email);
      expect(JSON.stringify(response.body)).not.toContain('"email"');
    }
    for (const search of ['missing-title', '.*']) {
      expect(
        asRecord(
          (
            await request(httpServer)
              .get('/api/projects')
              .query({ search })
              .expect(200)
          ).body as unknown,
        ).total,
      ).toBe(0);
    }
    for (const [sort, expectedId] of [
      ['funded', String(second._id)],
      ['ending', String(first._id)],
      ['newest', String(second._id)],
    ]) {
      const result = asRecord(
        (
          await request(httpServer)
            .get('/api/projects')
            .query({ search: 'Query Tes', sort, pageSize: 1 })
            .expect(200)
        ).body as unknown,
      );
      const items = result.projects as Array<Record<string, unknown>>;
      expect(String(items[0]._id)).toBe(expectedId);
      expect(result).toMatchObject({ total: 2, page: 1, pageSize: 1 });
    }
    const pageTwo = asRecord(
      (
        await request(httpServer)
          .get('/api/projects?search=Query%20Tes&page=2&pageSize=1&sort=funded')
          .expect(200)
      ).body as unknown,
    );
    expect((pageTwo.projects as Array<Record<string, unknown>>)[0]._id).toBe(
      String(first._id),
    );
    await request(httpServer).get('/api/projects?sort=unsupported').expect(400);
    await request(httpServer).get('/api/projects?page=1.5').expect(400);
    const detail = await request(httpServer)
      .get(`/api/projects/${String(first._id)}`)
      .expect(200);
    expect(JSON.stringify(detail.body)).not.toContain(payload.email);
    expect(JSON.stringify(detail.body)).not.toContain('"email"');
  });
});
