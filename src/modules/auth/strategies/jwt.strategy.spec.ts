import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from '../auth.service';
import { JwtStrategy } from './jwt.strategy';
import { UserRole } from '../../../common/enums/role.enum';

describe('JwtStrategy current account authorization', () => {
  const getProfile = jest.fn();
  const strategy = new JwtStrategy(
    {
      get: (key: string) =>
        key === 'JWT_SECRET' ? 'unit-test-secret' : undefined,
    } as ConfigService,
    { getProfile } as unknown as AuthService,
  );
  const payload = {
    sub: 'account-id',
    typ: 'access',
    roles: [UserRole.ADMIN],
    emailVerified: true,
  };

  beforeEach(() => getProfile.mockReset());

  it('does not restore revoked roles from an older access token', async () => {
    getProfile.mockResolvedValue({
      roles: [],
      permissions: [],
      emailVerifiedAt: new Date(),
    });
    expect(await strategy.validate(payload)).toMatchObject({
      roles: [],
      permissions: [],
      emailVerified: true,
    });
  });

  it.each([null, undefined])(
    'denies verification when the current account timestamp is %s',
    async (emailVerifiedAt) => {
      getProfile.mockResolvedValue({
        roles: [UserRole.INNOVATOR],
        emailVerifiedAt,
      });
      expect(await strategy.validate(payload)).toMatchObject({
        emailVerified: false,
      });
    },
  );

  it('recognizes completed verification without relying on a stale token', async () => {
    getProfile.mockResolvedValue({
      roles: [UserRole.INNOVATOR],
      emailVerifiedAt: new Date(),
    });
    expect(
      await strategy.validate({ ...payload, emailVerified: false }),
    ).toMatchObject({ emailVerified: true, roles: [UserRole.INNOVATOR] });
  });

  it('rejects inactive or blocked accounts rejected by getProfile', async () => {
    getProfile.mockRejectedValue(new UnauthorizedException());
    await expect(strategy.validate(payload)).rejects.toThrow(
      UnauthorizedException,
    );
  });
});
