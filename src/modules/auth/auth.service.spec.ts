import { AuthService } from './auth.service';
import { RolesService } from '../roles/roles.service';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { UserDocument } from '../users/schemas/user.schema';
import { Types } from 'mongoose';
import { AuditService } from '../audit/audit.service';
import * as crypto from 'crypto';
import sgMail from '@sendgrid/mail';
import { HttpException, UnauthorizedException } from '@nestjs/common';

jest.mock('@sendgrid/mail', () => ({
  setApiKey: jest.fn(),
  send: jest.fn().mockResolvedValue(undefined),
}));

type SimpleQuery<T> = { exec: jest.Mock<Promise<T>, []> };
type SelectableQuery<T> = {
  select: jest.Mock<SelectableQuery<T>, [unknown?]>;
  exec: jest.Mock<Promise<T | null>, []>;
};

const futureDate = () => new Date(Date.now() + 10 * 60 * 1000);

const hashCode = (code: string) =>
  crypto.createHash('sha256').update(code).digest('hex');

describe('AuthService email verification (codes)', () => {
  const email = 'test@example.com';
  const code = '123456';
  const codeHash = hashCode(code);

  let service: AuthService;
  type UserModelMock = {
    create: jest.Mock<Promise<UserDocument>, unknown[]>;
    findOne: jest.Mock<
      SelectableQuery<UserDocument | null>,
      [Record<string, unknown>?]
    >;
    findById: jest.Mock<SelectableQuery<UserDocument | null>, [string?]>;
    findByIdAndUpdate: jest.Mock<
      SimpleQuery<UserDocument | null>,
      [string, Record<string, unknown>, unknown?]
    >;
  };

  let userModel: UserModelMock;
  let rolesService: jest.Mocked<RolesService>;
  let configService: jest.Mocked<ConfigService>;
  let jwtService: jest.Mocked<JwtService>;
  let refreshTokenModel: Record<string, jest.Mock>;
  let auditService: jest.Mocked<AuditService>;
  let updates: Record<string, unknown>[];

  const makeQuery = <T>(result: T): SimpleQuery<T> => ({
    exec: jest.fn<Promise<T>, []>(() => Promise.resolve(result)),
  });

  const makeSelectableQuery = <T>(result: T): SelectableQuery<T> => {
    const query: SelectableQuery<T> = {
      exec: jest.fn<Promise<T | null>, []>(() => Promise.resolve(result)),
      select: jest.fn<SelectableQuery<T>, [unknown?]>(() => query),
    };
    return query;
  };

  beforeEach(() => {
    updates = [];
    userModel = {
      create: jest.fn<Promise<UserDocument>, unknown[]>(),
      findOne: jest.fn<
        SelectableQuery<UserDocument | null>,
        [Record<string, unknown>?]
      >(),
      findById: jest.fn<SelectableQuery<UserDocument | null>, [string?]>(),
      findByIdAndUpdate: jest.fn<
        SimpleQuery<UserDocument | null>,
        [string, Record<string, unknown>, unknown?]
      >(),
    };
    rolesService = {
      getPermissionsForRoles: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<RolesService>;
    configService = {
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as jest.Mocked<ConfigService>;
    jwtService = {
      signAsync: jest.fn(),
      verify: jest.fn(),
    } as unknown as jest.Mocked<JwtService>;
    refreshTokenModel = {
      findOne: jest.fn(),
      updateOne: jest.fn(),
    } as unknown as Record<string, jest.Mock>;
    auditService = {
      log: jest.fn(),
    } as unknown as jest.Mocked<AuditService>;
    service = new AuthService(
      userModel as unknown as any,
      refreshTokenModel as unknown as any,
      jwtService as unknown as JwtService,
      configService as unknown as ConfigService,
      rolesService as unknown as RolesService,
      auditService as unknown as AuditService,
    );
  });

  const mockUser = (overrides: Partial<UserDocument> = {}): UserDocument =>
    ({
      _id: new Types.ObjectId(),
      email,
      roles: [],
      isActive: true,
      isBlocked: false,
      emailVerifiedAt: undefined,
      emailVerificationCodeHash: codeHash,
      emailVerificationCodeExpiresAt: futureDate(),
      emailVerificationAttempts: 0,
      ...overrides,
    } as unknown as UserDocument);

  it('verifies with a valid code', async () => {
    const user = mockUser();
    userModel.findOne.mockReturnValue(makeSelectableQuery(user));
    userModel.findByIdAndUpdate.mockImplementation(
      (_id: string, update: Record<string, unknown>) => {
        updates.push(update);
        return makeQuery(user as UserDocument);
      },
    );

    const res = await service.verifyEmail({ code, email });
    expect(res?.message).toBe('Email verified');
    expect(updates[0]).toMatchObject({
      emailVerifiedAt: expect.any(Date),
      emailVerificationCodeHash: undefined,
      emailVerificationCodeExpiresAt: undefined,
      emailVerificationAttempts: 0,
      emailVerificationBlockedUntil: undefined,
    });
  });

  it('returns already verified when emailVerifiedAt is set', async () => {
    const user = mockUser({ emailVerifiedAt: new Date() });
    userModel.findOne.mockReturnValue(makeSelectableQuery(user));

    const res = await service.verifyEmail({ code, email });

    expect(res?.message).toBe('Email already verified');
  });

  it('increments attempts and blocks when exceeding limits', async () => {
    const user = mockUser({
      emailVerificationCodeHash: 'other',
      emailVerificationAttempts: 4,
    });
    userModel.findOne.mockReturnValue(makeSelectableQuery(user));
    userModel.findByIdAndUpdate.mockImplementation(
      (_id: string, update: Record<string, unknown>) => {
        updates.push(update);
        return makeQuery(user as UserDocument);
      },
    );

    await expect(service.verifyEmail({ code, email })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(updates[0]).toMatchObject({
      emailVerificationAttempts: 5,
      emailVerificationBlockedUntil: expect.any(Date),
    });
  });

  it('blocks immediately if blockedUntil is in the future', async () => {
    const user = mockUser({
      emailVerificationBlockedUntil: futureDate(),
    });
    userModel.findOne.mockReturnValue(makeSelectableQuery(user));

    await expect(service.verifyEmail({ code, email })).rejects.toBeInstanceOf(
      HttpException,
    );
  });

  it('resend issues a new code and updates hash/expiry', async () => {
    const user = mockUser();
    userModel.findOne.mockReturnValue(makeSelectableQuery(user));
    userModel.findByIdAndUpdate.mockImplementation(
      (_id: string, update: Record<string, unknown>) => {
        updates.push(update);
        return makeQuery(user as UserDocument);
      },
    );

    await service.resendVerificationEmail(email);

    expect(sgMail.send).toHaveBeenCalled();
    expect(updates[0]).toMatchObject({
      emailVerificationCodeHash: expect.any(String),
      emailVerificationCodeExpiresAt: expect.any(Date),
      emailVerificationAttempts: 0,
    } as Record<string, unknown>);
  });
});
