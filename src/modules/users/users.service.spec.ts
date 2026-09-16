import { ConfigService } from '@nestjs/config';
import { UserRole, KYCStatus } from '../../common/enums/role.enum';
import { CreatorVerificationStatus } from '../../common/enums/creator-verification-status.enum';
import { UsersService } from './users.service';

type UsersServiceDependencies = ConstructorParameters<typeof UsersService>;

describe('UsersService canonical profile capabilities', () => {
  const userId = '507f1f77bcf86cd799439012';
  const repository = { findById: jest.fn() };
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
});
