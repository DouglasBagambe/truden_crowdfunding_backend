import { ConfigService } from '@nestjs/config';
import type { Model } from 'mongoose';
import { KYCStatus, UserRole } from '../../../common/enums/role.enum';
import { CreatorVerificationStatus } from '../../../common/enums/creator-verification-status.enum';
import type { UserDocument } from '../schemas/user.schema';
import { UatBootstrapController } from './uat-bootstrap.controller';

function setup(
  nodeEnv = 'test',
  expectedSecret: string | undefined = 'uat-test-secret',
) {
  const user = {
    roles: [UserRole.INVESTOR],
    passwordHash: 'unchanged-hash',
    primaryWallet: 'unchanged-wallet',
    isActive: false,
    isBlocked: true,
    emailVerifiedAt: undefined as Date | undefined,
    kycStatus: KYCStatus.NOT_VERIFIED,
    kyc: {},
    creatorVerification: { status: CreatorVerificationStatus.NOT_SUBMITTED },
    save: jest.fn().mockResolvedValue(undefined),
  };
  const model = {
    findOne: jest
      .fn()
      .mockReturnValue({ select: jest.fn().mockResolvedValue(user) }),
  };
  const values: Record<string, string | undefined> = {
    NODE_ENV: nodeEnv,
    UAT_BOOTSTRAP_SECRET: expectedSecret,
  };
  const config = {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
  return {
    user,
    model,
    controller: new UatBootstrapController(
      model as unknown as Model<UserDocument>,
      config,
    ),
  };
}

describe('UatBootstrapController', () => {
  it.each(['production', 'development'])(
    'fails outside test (%s)',
    async (env) => {
      const { controller, model } = setup(env);
      await expect(
        controller.bootstrapAdmin(
          'douglasbagambe4@gmail.com',
          'uat-test-secret',
        ),
      ).rejects.toMatchObject({ status: 404 });
      expect(model.findOne).not.toHaveBeenCalled();
    },
  );
  it.each([undefined, 'wrong-secret'])(
    'rejects missing or invalid secret',
    async (secret) => {
      const { controller, model } = setup();
      await expect(
        controller.bootstrapAdmin('douglasbagambe4@gmail.com', secret),
      ).rejects.toMatchObject({ status: 503 });
      expect(model.findOne).not.toHaveBeenCalled();
    },
  );
  it('fails closed when no bootstrap secret is configured', async () => {
    const { controller } = setup('test', '');
    await expect(
      controller.bootstrapAdmin('douglasbagambe4@gmail.com', 'uat-test-secret'),
    ).rejects.toMatchObject({ status: 503 });
  });
  it('updates only an existing user while preserving roles, password and wallet', async () => {
    const { controller, user, model } = setup();
    const result = await controller.bootstrapAdmin(
      'DouglasBagambe4@gmail.com',
      'uat-test-secret',
    );
    expect(model.findOne).toHaveBeenCalledWith({
      email: 'douglasbagambe4@gmail.com',
    });
    expect(user.roles).toEqual([
      UserRole.INVESTOR,
      UserRole.ADMIN,
      UserRole.SUPERADMIN,
    ]);
    expect(user.isActive).toBe(true);
    expect(user.isBlocked).toBe(false);
    expect(user.emailVerifiedAt).toBeInstanceOf(Date);
    expect(user.kycStatus).toBe(KYCStatus.VERIFIED);
    expect(user.creatorVerification.status).toBe(
      CreatorVerificationStatus.VERIFIED,
    );
    expect(user.passwordHash).toBe('unchanged-hash');
    expect(user.primaryWallet).toBe('unchanged-wallet');
    expect(user.save).toHaveBeenCalledTimes(1);
    expect(result).not.toHaveProperty('passwordHash');
    expect(result).not.toHaveProperty('primaryWallet');
  });
  it('does not create a missing account', async () => {
    const { controller, model } = setup();
    model.findOne.mockReturnValue({
      select: jest.fn().mockResolvedValue(null),
    });
    await expect(
      controller.bootstrapAdmin('missing@example.test', 'uat-test-secret'),
    ).rejects.toMatchObject({ status: 404 });
  });
});
