import {
  ConflictException,
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { UserRole, KYCStatus } from '../../common/enums/role.enum';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { LinkWalletDto } from './dto/link-wallet.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { UpdateKycStatusDto } from './dto/update-kyc-status.dto';
import { BlockUserDto } from './dto/block-user.dto';
import { QueryUsersDto } from './dto/query-users.dto';
import { SubmitKycDto } from './dto/submit-kyc.dto';
import { SubmitCreatorVerificationDto } from './dto/submit-creator-verification.dto';
import { UpdateCreatorVerificationDto } from './dto/update-creator-verification.dto';
import { CreateKycSessionDto } from './dto/create-kyc-session.dto';
import { SmileWebhookDto } from './dto/smile-webhook.dto';
import { buildUserQuery } from './utils/user-query.util';
import { UsersRepository } from './repositories/users.repository';
import { UserEvent } from './listeners/user.events';
import type { UserEventPayload } from './listeners/user.events';
import type { UserDocument } from './schemas/user.schema';
import { CreatorVerificationStatus } from '../../common/enums/creator-verification-status.enum';
import { AuthService } from '../auth/auth.service';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class UsersService {
  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly events: EventEmitter2,
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  async createUser(dto: CreateUserDto) {
    const primaryWallet = dto.primaryWallet?.toLowerCase();
    if (primaryWallet) {
      await this.ensureWalletAvailable(primaryWallet);
    }
    if (dto.email) {
      await this.ensureEmailAvailable(dto.email);
    }
    const passwordHash = dto.password
      ? await bcrypt.hash(dto.password, 10)
      : undefined;

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
      kyc: {
        status: dto.kycStatus ?? KYCStatus.NOT_VERIFIED,
        accreditation: { isAccredited: false },
        homeAddress: null,
        attachments: [],
      },
      email: dto.email?.toLowerCase(),
      authProvider: passwordHash ? 'email' : 'email',
      passwordHash,
      isActive: true,
      profile: {
        displayName: dto.displayName,
        avatarUrl: dto.avatarUrl,
        country: dto.country,
      },
      creatorVerification: {
        status: dto.creatorVerificationStatus ?? CreatorVerificationStatus.NOT_SUBMITTED,
        evidenceUrls: [],
        attachments: [],
      },
      avatar: this.parseAvatar(dto.avatarBase64),
    });

    this.emitEvent(UserEvent.Created, {
      userId: String(user.id),
      primaryWallet: user.primaryWallet,
    });

    return this.sanitizeUser(user);
  }

  async getUserById(id: string) {
    const user = await this.usersRepository.findById(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return this.sanitizeUser(user);
  }

  async listUsers(query: QueryUsersDto) {
    const filter = buildUserQuery(query);
    const [users, total] = await Promise.all([
      this.usersRepository.query(filter, query.limit, query.skip),
      this.usersRepository.count(filter),
    ]);
    return { users: users.map((u) => this.sanitizeUser(u)), total };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const setPayload: Record<string, unknown> = {};
    if (dto.displayName !== undefined)
      setPayload['profile.displayName'] = dto.displayName;
    if (dto.email !== undefined) setPayload['email'] = dto.email.toLowerCase();
    if (dto.avatarUrl !== undefined)
      setPayload['profile.avatarUrl'] = dto.avatarUrl;
    if (dto.avatarBase64 !== undefined)
      setPayload['avatar'] = this.parseAvatar(dto.avatarBase64);
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

    return this.sanitizeUser(user);
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
    return this.sanitizeUser(user);
  }

  async submitKyc(userId: string, dto: SubmitKycDto) {
    const user = await this.usersRepository.updateById(userId, {
      $set: {
        kycStatus: KYCStatus.PENDING,
        'kyc.status': KYCStatus.PENDING,
        'kyc.dateOfBirth': dto.dateOfBirth ? new Date(dto.dateOfBirth) : null,
        'kyc.documentType': dto.documentType,
        'kyc.documentCountry': dto.documentCountry,
        'kyc.documentLast4': dto.documentLast4,
        'kyc.homeAddress': dto.homeAddress ?? null,
        'kyc.attachments': dto.attachments ?? [],
        'kyc.submittedAt': new Date(),
        'kyc.failureReason': null,
      },
    });
    if (!user) throw new NotFoundException('User not found');
    this.emitEvent(UserEvent.KycUpdated, {
      userId: String(user.id),
      primaryWallet: user.primaryWallet,
      changes: { kycStatus: KYCStatus.PENDING },
    });
    return this.sanitizeUser(user);
  }

  async createSmileKycSession(userId: string, dto: CreateKycSessionDto) {
    const cfg = this.getSmileConfig();
    const jobId = crypto.randomUUID();
    const timestamp = Date.now().toString();
    const signature = this.buildSmileSignature(cfg.partnerId, jobId, timestamp, cfg.apiKey);

    const payload = {
      job_type: 1, // Document verification; add selfie/liveness in Smile config
      partner_params: {
        user_id: userId,
        job_id: jobId,
      },
      callback_url: cfg.callbackUrl,
      id_info: {
        country: dto.documentCountry,
        id_type: dto.documentType,
      },
    };

    // If you need to call Smile's API from the backend, inject HttpService again and restore the call.

    const user = await this.usersRepository.startKycSession(userId, {
      $set: {
        kycStatus: KYCStatus.PENDING,
        'kyc.status': KYCStatus.PENDING,
        'kyc.provider': 'smile_id',
        'kyc.providerSessionId': jobId,
        'kyc.providerStatus': 'IN_PROGRESS',
        'kyc.providerFailureReason': null,
        'kyc.submittedAt': new Date(),
      },
    });
    if (!user) throw new NotFoundException('User not found');

    return {
      jobId,
      signature,
      timestamp,
      partnerId: cfg.partnerId,
      callbackUrl: cfg.callbackUrl,
      status: 'IN_PROGRESS',
      note:
        'Submit this token to Smile ID client SDK; backend does not call Smile directly in this scaffold.',
    };
  }

  async handleSmileWebhook(dto: SmileWebhookDto) {
    const cfg = this.getSmileConfig();
    const expectedSig = this.buildSmileSignature(
      cfg.partnerId,
      dto.job_id,
      dto.timestamp,
      cfg.apiKey,
    );
    if (expectedSig !== dto.signature) {
      throw new BadRequestException('Invalid Smile ID signature');
    }

    const partnerParams = this.safeParseJson(dto.partner_params);
    const result = this.safeParseJson(dto.result);
    const userId = partnerParams?.user_id ?? partnerParams?.userId;
    if (!userId) {
      throw new BadRequestException('Missing user_id in Smile callback');
    }

    const passed = result?.ResultText === 'Passed' || result?.Passed === true;
    const failureReason = result?.ResultText || result?.Errors?.[0]?.Message;
    const providerStatus = passed ? 'VERIFIED' : 'REJECTED';
    const kycStatus = passed ? KYCStatus.VERIFIED : KYCStatus.REJECTED;

    const setPayload: Record<string, unknown> = {
      kycStatus,
      'kyc.status': kycStatus,
      'kyc.provider': 'smile_id',
      'kyc.providerSessionId': dto.job_id,
      'kyc.providerStatus': providerStatus,
      'kyc.providerFailureReason': passed ? null : failureReason,
      'kyc.verifiedAt': passed ? new Date() : undefined,
    };

    if (result?.ResultURL) {
      setPayload['kyc.providerResultUrl'] = result.ResultURL;
    }
    const dob = result?.DOB || result?.dob;
    if (dob) {
      setPayload['kyc.dateOfBirth'] = new Date(dob);
    }
    const address = result?.Address || result?.address;
    if (address) {
      setPayload['kyc.homeAddress'] = {
        line1: address?.Street || address?.line1,
        line2: address?.line2,
        city: address?.City || address?.city,
        state: address?.State || address?.state,
        postalCode: address?.PostalCode || address?.postalCode,
        country: address?.Country || address?.country,
      };
    }

    const user = await this.usersRepository.applyKycResult(userId, {
      $set: setPayload,
    });
    if (!user) throw new NotFoundException('User not found');

    this.emitEvent(UserEvent.KycUpdated, {
      userId: String(user.id),
      primaryWallet: user.primaryWallet,
      changes: { kycStatus },
    });

    return this.sanitizeUser(user);
  }

  async submitCreatorVerification(
    userId: string,
    dto: SubmitCreatorVerificationDto,
  ) {
    const user = await this.usersRepository.updateById(userId, {
      $set: {
        'creatorVerification.status': CreatorVerificationStatus.PENDING,
        'creatorVerification.evidenceUrls': dto.evidenceUrls ?? [],
        'creatorVerification.attachments': dto.attachments ?? [],
        'creatorVerification.submittedAt': new Date(),
        'creatorVerification.failureReason': null,
      },
    });
    if (!user) throw new NotFoundException('User not found');
    this.emitEvent(UserEvent.KycUpdated, {
      userId: String(user.id),
      primaryWallet: user.primaryWallet,
      changes: { creatorVerificationStatus: CreatorVerificationStatus.PENDING },
    });
    return this.sanitizeUser(user);
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
    return this.sanitizeUser(user);
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
    return this.sanitizeUser(user);
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
    return this.sanitizeUser(user);
  }

  async updateCreatorVerificationStatus(
    userId: string,
    dto: UpdateCreatorVerificationDto,
  ) {
    const now = new Date();
    const user = await this.usersRepository.updateById(userId, {
      $set: {
        'creatorVerification.status': dto.status,
        'creatorVerification.failureReason': dto.reason,
        'creatorVerification.verifiedAt':
          dto.status === CreatorVerificationStatus.VERIFIED ? now : undefined,
      },
    });
    if (!user) throw new NotFoundException('User not found');
    this.emitEvent(UserEvent.KycUpdated, {
      userId: String(user.id),
      primaryWallet: user.primaryWallet,
      changes: { creatorVerificationStatus: dto.status },
    });
    return this.sanitizeUser(user);
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
    return this.sanitizeUser(user);
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
    return user ? this.sanitizeUser(user) : user;
  }

  private async ensureWalletAvailable(wallet: string, ownerId?: string) {
    const normalizedWallet = wallet.toLowerCase();
    const existing: UserDocument | null =
      await this.usersRepository.findByWallet(normalizedWallet);
    if (existing && existing.id !== ownerId) {
      throw new ConflictException('Wallet already linked to another user');
    }
  }

  private async ensureEmailAvailable(email: string, ownerId?: string) {
    const normalizedEmail = email.toLowerCase().trim();
    const existing = await this.usersRepository.findByEmail(normalizedEmail);
    if (existing && existing.id !== ownerId) {
      throw new ConflictException('Email already in use');
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

  private getSmileConfig() {
    const partnerId =
      this.configService.get<string>('smileId.partnerId') ||
      process.env.SMILE_ID_PARTNER_ID;
    const apiKey =
      this.configService.get<string>('smileId.apiKey') ||
      process.env.SMILE_ID_API_KEY;
    const baseUrl =
      this.configService.get<string>('smileId.baseUrl') ||
      process.env.SMILE_ID_BASE_URL ||
      'https://testapi.smileidentity.com/v1';
    const callbackUrl =
      this.configService.get<string>('smileId.callbackUrl') ||
      process.env.SMILE_ID_CALLBACK_URL ||
      'https://localhost:3000/api/webhooks/kyc/smile';

    if (!partnerId || !apiKey) {
      throw new BadRequestException('Smile ID is not configured');
    }
    return { partnerId, apiKey, baseUrl, callbackUrl };
  }

  private buildSmileSignature(
    partnerId: string,
    jobId: string,
    timestamp: string,
    apiKey: string,
  ) {
    return crypto
      .createHash('sha256')
      .update(partnerId + jobId + timestamp + apiKey)
      .digest('hex');
  }

  private safeParseJson(value: unknown) {
    if (typeof value !== 'string') return undefined;
    try {
      return JSON.parse(value);
    } catch {
      return undefined;
    }
  }

  private sanitizeUser(user: UserDocument) {
    const obj = user.toObject();
    delete (obj as any).password;
    delete (obj as any).passwordHash;
    return obj;
  }

  private parseAvatar(base64?: string) {
    if (!base64) return undefined;
    let raw = base64.trim();
    let mimeType: string | undefined;

    const dataUrlMatch = raw.match(/^data:(.+);base64,(.*)$/);
    if (dataUrlMatch) {
      mimeType = dataUrlMatch[1];
      raw = dataUrlMatch[2];
    }

    try {
      const data = Buffer.from(raw, 'base64');
      if (!data.length) {
        throw new Error('empty');
      }
      return { data, mimeType };
    } catch {
      throw new BadRequestException('Invalid avatar base64 payload');
    }
  }
}
