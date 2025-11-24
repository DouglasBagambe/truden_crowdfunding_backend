import { FilterQuery } from 'mongoose';
import { QueryUsersDto } from '../dto/query-users.dto';
import { UserDocument } from '../schemas/user.schema';

export const buildUserQuery = (
  params: QueryUsersDto,
): FilterQuery<UserDocument> => {
  const filter: FilterQuery<UserDocument> = {};

  if (params.role) {
    filter.roles = params.role;
  }

  if (typeof params.isBlocked === 'boolean') {
    filter.isBlocked = params.isBlocked;
  }

  if (params.kycStatus) {
    filter.kycStatus = params.kycStatus;
  }

  if (params.search) {
    const regex = new RegExp(params.search, 'i');
    filter.$or = [
      { primaryWallet: regex },
      { linkedWallets: regex },
      { email: regex },
      { 'profile.displayName': regex },
    ];
  }

  return filter;
};
