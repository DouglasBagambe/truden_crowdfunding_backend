import 'dotenv/config';
import * as bcrypt from 'bcryptjs';
import { connect, connection } from 'mongoose';
import appConfig from '../config/app.config';
import { User, UserSchema } from '../modules/users/schemas/user.schema';
import { UserRole } from '../common/enums/role.enum';

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

  const existing = await UserModel.findOne({ email }).select('+password');
  const hashedPassword = await bcrypt.hash(password, 10);

  if (existing) {
    existing.password = hashedPassword;
    existing.roles = Array.from(
      new Set([...(existing.roles || []), UserRole.ADMIN]),
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
    await existing.save();
    console.log(`Admin user updated: ${email}`);
  } else {
    await UserModel.create({
      email,
      password: hashedPassword,
      roles: [UserRole.ADMIN],
      isActive: true,
      isBlocked: false,
      profile: {
        firstName,
        lastName,
        displayName: [firstName, lastName].filter(Boolean).join(' ').trim(),
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
