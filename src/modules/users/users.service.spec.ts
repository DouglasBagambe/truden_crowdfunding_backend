import { ConfigService } from '@nestjs/config';
import { ForbiddenException } from '@nestjs/common';
import { UserRole, KYCStatus } from '../../common/enums/role.enum';
import { CreatorVerificationStatus } from '../../common/enums/creator-verification-status.enum';
import { UsersService } from './users.service';

type UsersServiceDependencies = ConstructorParameters<typeof UsersService>;

describe('UsersService canonical profile capabilities', () => {
  const userId = '507f1f77bcf86cd799439012';
  const repository = { findById: jest.fn(), addRole: jest.fn() };
  const config = {
    get: jest.fn((key: string) =>
      key === 'ROI_ALLOWED_USER_IDS' ? userId : undefined,
    ),
  } as unknown as ConfigService;

  const createService = () =>
    new UsersService(
      {} as UsersServiceDependencies[0],
      repository as unknown as UsersServiceDependencies[1],
      { emit: jest.fn() } as unknown as UsersServiceDependencies[2],
      {} as UsersServiceDependencies[3],
      config as unknown as UsersServiceDependencies[4],
      { log: jest.fn() } as unknown as UsersServiceDependencies[5],
      {} as UsersServiceDependencies[6],
    );

  beforeEach(() => jest.clearAllMocks());

  it('maps roles, KYC, and backend policy into a canonical capability response', async () => {
    repository.findById.mockResolvedValue({
      id: userId,
      roles: [UserRole.INNOVATOR],
      isActive: true,
      isBlocked: false,
      kycStatus: KYCStatus.VERIFIED,
      kyc: { status: KYCStatus.VERIFIED },
      creatorVerification: { status: CreatorVerificationStatus.VERIFIED },
      toObject: () => ({
        _id: userId,
        roles: [UserRole.INNOVATOR],
        kycStatus: KYCStatus.VERIFIED,
        kyc: { status: KYCStatus.VERIFIED },
      }),
    });

    const profile = await createService().getUserById(userId);

    expect(profile).toMatchObject({
      roles: [UserRole.INNOVATOR],
      kycStatus: KYCStatus.VERIFIED,
      capabilities: {
        createCharity: true,
        createRoi: true,
        viewRoi: true,
      },
    });
  });

  it('does not grant ROI creation to a creator without verified KYC', async () => {
    repository.findById.mockResolvedValue({
      id: userId,
      roles: [UserRole.INNOVATOR],
      isActive: true,
      isBlocked: false,
      kycStatus: KYCStatus.PENDING,
      kyc: { status: KYCStatus.PENDING },
      creatorVerification: { status: CreatorVerificationStatus.VERIFIED },
      toObject: () => ({
        roles: [UserRole.INNOVATOR],
        kycStatus: KYCStatus.PENDING,
      }),
    });

    const profile = await createService().getUserById(userId);

    expect(profile.capabilities).toEqual({
      createCharity: true,
      createRoi: false,
      viewRoi: true,
    });
  });

  it('enrolls an email-verified user as a Charity Creator without granting ROI access', async () => {
    const enrolled = {
      id: userId,
      roles: [UserRole.INVESTOR, UserRole.INNOVATOR],
      isActive: true,
      isBlocked: false,
      emailVerifiedAt: new Date(),
      toObject: () => ({
        id: userId,
        roles: [UserRole.INVESTOR, UserRole.INNOVATOR],
      }),
    };
    repository.findById.mockResolvedValue(enrolled);
    repository.addRole.mockResolvedValue(enrolled);

    const usersService = createService();
    const profile = await usersService.enrollAsCharityCreator(userId);
    const repeatedProfile = await usersService.enrollAsCharityCreator(userId);

    expect(repository.addRole).toHaveBeenCalledWith(userId, UserRole.INNOVATOR);
    expect(profile.capabilities).toMatchObject({
      createCharity: true,
      createRoi: false,
    });
    expect(repeatedProfile.roles).toEqual([
      UserRole.INVESTOR,
      UserRole.INNOVATOR,
    ]);
    expect(repository.addRole).toHaveBeenCalledTimes(2);
  });

  it('requires email verification before Charity Creator enrollment', async () => {
    repository.findById.mockResolvedValue({
      id: userId,
      roles: [UserRole.INVESTOR],
      isActive: true,
      isBlocked: false,
      emailVerifiedAt: undefined,
    });

    await expect(
      createService().enrollAsCharityCreator(userId),
    ).rejects.toEqual(
      new ForbiddenException(
        'Verify your email before becoming a Charity Creator',
      ),
    );
    expect(repository.addRole).not.toHaveBeenCalled();
  });
});
