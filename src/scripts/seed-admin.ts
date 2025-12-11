import 'dotenv/config';
import * as bcrypt from 'bcryptjs';
import { connect, connection } from 'mongoose';
import appConfig from '../config/app.config';
import { User, UserSchema } from '../modules/users/schemas/user.schema';
import { UserRole, KYCStatus } from '../common/enums/role.enum';
import { CreatorVerificationStatus } from '../common/enums/creator-verification-status.enum';

async function seedAdmin() {
  const config = appConfig();
  const mongoUri = process.env.MONGO_URI || config.database.uri;

  if (!mongoUri) {
    throw new Error('MONGO_URI (or database.uri) is not set');
  }

  await connect(mongoUri);
  const UserModel = connection.model(User.name, UserSchema);

  const email = (process.env.ADMIN_EMAIL || 'admin@truden.net').toLowerCase();
  const password = process.env.ADMIN_PASSWORD || 'F13ryl10n!';
  const firstName = process.env.ADMIN_FIRST_NAME || 'Admin';
  const lastName = process.env.ADMIN_LAST_NAME || 'User';

  const existing = await UserModel.findOne({ email }).select('+passwordHash');
  const hashedPassword = await bcrypt.hash(password, 10);
  const now = new Date();

  if (existing) {
    existing.passwordHash = hashedPassword;
    existing.roles = Array.from(
      new Set([...(existing.roles || []), UserRole.ADMIN, UserRole.SUPERADMIN]),
    );
    existing.profile = {
      ...existing.profile,
      firstName: existing.profile?.firstName || firstName,
      lastName: existing.profile?.lastName || lastName,
      displayName:
        existing.profile?.displayName ||
        [firstName, lastName].filter(Boolean).join(' ').trim(),
    };
    existing.isActive = true;
    existing.isBlocked = false;
    existing.emailVerifiedAt = existing.emailVerifiedAt ?? now;
    existing.emailVerificationSentAt = existing.emailVerificationSentAt ?? now;
    existing.emailVerificationCodeHash = undefined;
    existing.emailVerificationCodeExpiresAt = undefined;
    existing.emailVerificationAttempts = 0;
    existing.emailVerificationSendCount = existing.emailVerificationSendCount ?? 0;
    existing.kycStatus = KYCStatus.VERIFIED;
    existing.kyc = {
      ...(existing.kyc || {}),
      status: KYCStatus.VERIFIED,
      provider: existing.kyc?.provider,
      providerStatus: existing.kyc?.providerStatus ?? 'VERIFIED',
      providerSessionId: existing.kyc?.providerSessionId,
      providerResultUrl: existing.kyc?.providerResultUrl,
      providerFailureReason: undefined,
      submittedAt: existing.kyc?.submittedAt ?? now,
      verifiedAt: now,
      accreditation: existing.kyc?.accreditation ?? { isAccredited: false },
    };
    existing.creatorVerification = {
      ...(existing.creatorVerification || {}),
      status: CreatorVerificationStatus.VERIFIED,
      evidenceUrls: existing.creatorVerification?.evidenceUrls ?? [],
      attachments: existing.creatorVerification?.attachments ?? [],
      failureReason: undefined,
      submittedAt: existing.creatorVerification?.submittedAt ?? now,
      verifiedAt: now,
    };
    await existing.save();
    console.log(`Admin user updated: ${email}`);
  } else {
    await UserModel.create({
      email,
      passwordHash: hashedPassword,
      authProvider: 'email',
      roles: [UserRole.SUPERADMIN, UserRole.ADMIN],
      isActive: true,
      isBlocked: false,
      emailVerifiedAt: now,
      emailVerificationSentAt: now,
      emailVerificationSendCount: 0,
      kycStatus: KYCStatus.VERIFIED,
      kyc: {
        status: KYCStatus.VERIFIED,
        provider: 'seeded',
        providerStatus: 'VERIFIED',
        providerSessionId: null,
        providerResultUrl: null,
        providerFailureReason: undefined,
        submittedAt: now,
        verifiedAt: now,
        accreditation: { isAccredited: false },
      },
      profile: {
        firstName,
        lastName,
        displayName: [firstName, lastName].filter(Boolean).join(' ').trim(),
      },
      creatorVerification: {
        status: CreatorVerificationStatus.VERIFIED,
        evidenceUrls: [],
        attachments: [],
        failureReason: undefined,
        submittedAt: now,
        verifiedAt: now,
      },
    });
    console.log(`Admin user created: ${email}`);
  }
}

seedAdmin()
  .catch((err) => {
    console.error('Admin seeding failed:', err.message);
    process.exit(1);
  })
  .finally(async () => {
    await connection.close();
  });
