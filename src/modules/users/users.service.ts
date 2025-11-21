import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { UserRole, KYCStatus } from '../../common/enums/role.enum';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { LinkWalletDto } from './dto/link-wallet.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { UpdateKycStatusDto } from './dto/update-kyc-status.dto';
import { BlockUserDto } from './dto/block-user.dto';
import { QueryUsersDto } from './dto/query-users.dto';
import { buildUserQuery } from './utils/user-query.util';
import { UsersRepository } from './repositories/users.repository';
import { UserEvent } from './listeners/user.events';
import type { UserEventPayload } from './listeners/user.events';
import type { UserDocument } from './schemas/user.schema';

@Injectable()
export class UsersService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly events: EventEmitter2,
  ) {}

  async createUser(dto: CreateUserDto) {
    const primaryWallet = dto.primaryWallet.toLowerCase();
    await this.ensureWalletAvailable(primaryWallet);

    const linkedWallets = this.normalizeLinkedWallets(
      dto.linkedWallets,
      primaryWallet,
    );
    for (const wallet of linkedWallets) {
      await this.ensureWalletAvailable(wallet);
    }

    const user: UserDocument = await this.usersRepository.create({
      primaryWallet,
      linkedWallets,
      roles: [dto.role ?? UserRole.INVESTOR],
      kycStatus: dto.kycStatus ?? KYCStatus.NOT_VERIFIED,
      email: dto.email.toLowerCase(),
      isActive: true,
      profile: {
        displayName: dto.displayName,
        avatarUrl: dto.avatarUrl,
        country: dto.country,
      },
    });

    this.emitEvent(UserEvent.Created, {
      userId: String(user.id),
      primaryWallet: user.primaryWallet,
    });

    return user;
  }

  async getUserById(id: string) {
    const user = await this.usersRepository.findById(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async listUsers(query: QueryUsersDto) {
    const filter = buildUserQuery(query);
    const [items, total] = await Promise.all([
      this.usersRepository.query(filter, query.limit, query.skip),
      this.usersRepository.count(filter),
    ]);
    return { items, total };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const setPayload: Record<string, unknown> = {};
    if (dto.displayName !== undefined)
      setPayload['profile.displayName'] = dto.displayName;
    if (dto.email !== undefined) setPayload['email'] = dto.email.toLowerCase();
    if (dto.avatarUrl !== undefined)
      setPayload['profile.avatarUrl'] = dto.avatarUrl;
    if (dto.country !== undefined) setPayload['profile.country'] = dto.country;

    const user: UserDocument | null = await this.usersRepository.updateById(
      userId,
      {
        $set: setPayload,
      },
    );

    if (!user) {
      throw new NotFoundException('User not found');
    }

    this.emitEvent(UserEvent.UpdatedProfile, {
      userId: String(user.id),
      primaryWallet: user.primaryWallet,
      changes: { profile: dto },
    });

    return user;
  }

  async linkWallet(userId: string, dto: LinkWalletDto) {
    const wallet = dto.wallet.toLowerCase();
    const currentUser: UserDocument | null =
      await this.usersRepository.findById(userId);
    if (!currentUser) {
      throw new NotFoundException('User not found');
    }

    if (currentUser.primaryWallet === wallet) {
      throw new ConflictException(
        'Wallet is already set as the primary wallet',
      );
    }

    await this.ensureWalletAvailable(wallet, userId);
    const user: UserDocument | null =
      await this.usersRepository.addLinkedWallet(userId, wallet);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    this.emitEvent(UserEvent.LinkedWallet, {
      userId: String(user.id),
      primaryWallet: user.primaryWallet,
      changes: { wallet },
    });
    return user;
  }

  async unlinkWallet(userId: string, dto: LinkWalletDto) {
    const wallet = dto.wallet.toLowerCase();
    const user: UserDocument | null =
      await this.usersRepository.removeLinkedWallet(userId, wallet);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    this.emitEvent(UserEvent.UnlinkedWallet, {
      userId: String(user.id),
      primaryWallet: user.primaryWallet,
      changes: { wallet },
    });
    return user;
  }

  async updateRole(userId: string, dto: UpdateRoleDto) {
    const user: UserDocument | null = await this.usersRepository.updateRole(
      userId,
      dto.role,
    );
    if (!user) {
      throw new NotFoundException('User not found');
    }
    this.emitEvent(UserEvent.RoleChanged, {
      userId: String(user.id),
      primaryWallet: user.primaryWallet,
      changes: { role: dto.role },
    });
    return user;
  }

  async updateKycStatus(userId: string, dto: UpdateKycStatusDto) {
    const user: UserDocument | null =
      await this.usersRepository.updateKycStatus(userId, dto.kycStatus);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    this.emitEvent(UserEvent.KycUpdated, {
      userId: String(user.id),
      primaryWallet: user.primaryWallet,
      changes: { kycStatus: dto.kycStatus },
    });
    return user;
  }

  async blockUser(userId: string, dto: BlockUserDto) {
    const user: UserDocument | null = await this.usersRepository.updateById(
      userId,
      {
        $set: { isBlocked: dto.isBlocked, isActive: !dto.isBlocked },
      },
    );
    if (!user) {
      throw new NotFoundException('User not found');
    }
    this.emitEvent(dto.isBlocked ? UserEvent.Blocked : UserEvent.Unblocked, {
      userId: String(user.id),
      primaryWallet: user.primaryWallet,
      changes: { reason: dto.reason },
    });
    return user;
  }

  async recordLogin(userId: string) {
    const user: UserDocument | null = await this.usersRepository.updateById(
      userId,
      {
        $set: { lastLoginAt: new Date() },
      },
    );
    if (user) {
      this.emitEvent(UserEvent.LoggedIn, {
        userId: String(user.id),
        primaryWallet: user.primaryWallet,
      });
    }
    return user;
  }

  private async ensureWalletAvailable(wallet: string, ownerId?: string) {
    const normalizedWallet = wallet.toLowerCase();
    const existing: UserDocument | null =
      await this.usersRepository.findByWallet(normalizedWallet);
    if (existing && existing.id !== ownerId) {
      throw new ConflictException('Wallet already linked to another user');
    }
  }

  private normalizeLinkedWallets(
    wallets: string[] | undefined,
    primaryWallet?: string,
  ) {
    if (!wallets || wallets.length === 0) {
      return [];
    }

    const normalizedPrimary = primaryWallet?.toLowerCase();
    const uniqueWallets = new Set<string>();

    for (const wallet of wallets) {
      if (typeof wallet !== 'string') {
        continue;
      }
      const normalized = wallet.trim().toLowerCase();
      if (!normalized || normalized === normalizedPrimary) {
        continue;
      }
      uniqueWallets.add(normalized);
    }

    return Array.from(uniqueWallets);
  }

  private emitEvent(event: UserEvent, payload: UserEventPayload) {
    const emitter = this.events as {
      emit: (event: UserEvent, payload: UserEventPayload) => unknown;
    };
    emitter.emit(event, payload);
  }
}
