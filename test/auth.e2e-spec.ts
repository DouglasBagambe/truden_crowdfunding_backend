import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server-core';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { Permission } from '../src/common/enums/permission.enum';
import { UserRole } from '../src/common/enums/role.enum';
import { User, UserDocument } from '../src/modules/users/schemas/user.schema';

jest.setTimeout(30000);

type AuthUser = {
  email?: string;
  roles: UserRole[];
  permissions: Permission[];
  profile: {
    displayName?: string;
    firstName?: string;
    lastName?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

type AuthResponse = {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
};

type RefreshResponse = {
  accessToken: string;
  refreshToken: string;
  permissions: Permission[];
};

const isAuthUser = (value: unknown): value is AuthUser => {
  if (!value || typeof value !== 'object') return false;
  const { roles, permissions } = value as Record<string, unknown>;
  return Array.isArray(roles) && Array.isArray(permissions);
};

const isAuthResponse = (value: unknown): value is AuthResponse => {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.accessToken === 'string' &&
    typeof record.refreshToken === 'string' &&
    isAuthUser(record.user)
  );
};

const isRefreshResponse = (value: unknown): value is RefreshResponse => {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.accessToken === 'string' &&
    typeof record.refreshToken === 'string' &&
    Array.isArray(record.permissions)
  );
};

describe('Auth integration (e2e)', () => {
  let app: INestApplication;
  let mongo: MongoMemoryServer | null = null;
  let userModel: Model<UserDocument>;

  const registerPayload = {
    email: 'alice@example.com',
    password: 'P@ssw0rd123',
    firstName: 'Alice',
    lastName: 'Tester',
  };

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    process.env.MONGO_URI = mongo.getUri();
    process.env.JWT_SECRET = 'test-jwt-secret';
    process.env.REFRESH_TOKEN_SECRET = 'test-refresh-secret';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.setGlobalPrefix('api');

    await app.init();

    userModel = app.get<Model<UserDocument>>(getModelToken(User.name));
  });

  afterAll(async () => {
    await app.close();
    await mongoose.disconnect();
    if (mongo) {
      await mongo.stop();
    }
  });

  afterEach(async () => {
    await userModel.deleteMany({});
  });

  async function registerUser(overrides: Partial<typeof registerPayload> = {}) {
    const payload = { ...registerPayload, ...overrides };
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send(payload)
      .expect(201);
    if (!isAuthResponse(res.body)) {
      throw new Error('Unexpected auth response shape');
    }
    return res.body;
  }

  it('registers a user with default roles and permissions', async () => {
    const response = await registerUser();

    expect(response.accessToken).toBeDefined();
    expect(response.refreshToken).toBeDefined();
    expect(response.user.email).toBe(registerPayload.email.toLowerCase());
    expect(response.user.roles).toEqual([UserRole.INVESTOR]);
    expect(response.user.permissions).toEqual(
      expect.arrayContaining([Permission.INVEST]),
    );
    expect(response.user.password).toBeUndefined();
    expect(response.user.profile.displayName).toBe('Alice Tester');
  });

  it('logs in an existing user and returns tokens', async () => {
    await registerUser();

    const loginRes = await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        email: registerPayload.email,
        password: registerPayload.password,
      })
      .expect(200);

    if (!isAuthResponse(loginRes.body)) {
      throw new Error('Unexpected login response shape');
    }

    expect(loginRes.body.accessToken).toBeDefined();
    expect(loginRes.body.refreshToken).toBeDefined();
    expect(loginRes.body.user.email).toBe(registerPayload.email.toLowerCase());
    expect(loginRes.body.user.permissions).toContain(Permission.INVEST);
  });

  it('rejects invalid login attempts', async () => {
    await registerUser();

    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({
        email: registerPayload.email,
        password: 'wrong-password',
      })
      .expect(401);
  });

  it('returns the authenticated user profile', async () => {
    const { accessToken, user } = await registerUser();

    const profileRes = await request(app.getHttpServer())
      .get('/api/auth/profile')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    if (!isAuthUser(profileRes.body)) {
      throw new Error('Unexpected profile response shape');
    }

    expect(profileRes.body.email).toBe(user.email);
    expect(profileRes.body.roles).toEqual(user.roles);
    expect(profileRes.body.permissions).toEqual(
      expect.arrayContaining([Permission.INVEST]),
    );
  });

  it('refreshes tokens using a valid refresh token', async () => {
    const { refreshToken } = await registerUser();

    const refreshRes = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken })
      .expect(200);

    if (!isRefreshResponse(refreshRes.body)) {
      throw new Error('Unexpected refresh response shape');
    }

    expect(refreshRes.body.accessToken).toBeDefined();
    expect(refreshRes.body.refreshToken).toBeDefined();
    expect(refreshRes.body.permissions).toEqual(
      expect.arrayContaining([Permission.INVEST]),
    );
  });
});
