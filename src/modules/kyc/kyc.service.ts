import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, FilterQuery } from 'mongoose';
import { KYCStatus } from '../../common/enums/role.enum';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  AdminKycProfileListItem,
  KycApplicationStatus,
  KycDocumentView,
  KycProfileListResponse,
  KycProfileView,
} from './interfaces/kyc.interface';
import {
  KycDocument,
  KycProfile,
  KycProfileDocument,
} from './schemas/kyc-profile.schema';
import { UpdateKycProfileDto } from './dto/update-kyc-profile.dto';
import { UploadKycDocumentDto } from './dto/upload-kyc-document.dto';
import { SubmitKycApplicationDto } from './dto/submit-kyc-application.dto';
import { AdminFilterKycDto } from './dto/admin-filter-kyc.dto';
import { AdminOverrideKycStatusDto } from './dto/admin-override-kyc-status.dto';
import { KycWebhookDto } from './dto/kyc-webhook.dto';
import {
  KycProviderStatusResult,
  KycProviderSubmitResult,
} from './providers/kyc-provider.interface';
import { DiditKycProviderService } from './providers/didit-kyc.provider';
// NOTE: LaboremusKycProviderService (KYB for businesses) removed for now.
// Didit handles KYC for ALL user types. Re-add Laboremus when KYB is needed.
import { DummyKycProviderService } from './providers/dummy-kyc.provider';
import {
  KycWebhookEvent,
  KycWebhookEventDocument,
} from './schemas/kyc-webhook-event.schema';
import { AuditService } from '../audit/audit.service';

/** KYC expires after 12 months and must be renewed */
const KYC_EXPIRY_MONTHS = 12;

@Injectable()
export class KycService {
  private readonly logger = new Logger(KycService.name);

  constructor(
    @InjectModel(KycProfile.name)
    private readonly profileModel: Model<KycProfileDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(KycWebhookEvent.name)
    private readonly webhookEventModel: Model<KycWebhookEventDocument>,
    private readonly configService: ConfigService,
    private readonly diditProvider: DiditKycProviderService,
    private readonly dummyProvider: DummyKycProviderService,
    private readonly auditService: AuditService,
  ) {}

  // ─────────────────────────────────────────────
  // Public user-facing API
  // ─────────────────────────────────────────────

  async getProfileForUser(userId: string): Promise<KycProfileView> {
    const user = await this.findUser(userId);
    const profile = await this.getOrCreateProfileForUser(user._id);
    await this.checkAndMarkExpired(profile, user);

    // Auto-refresh from Didit if status is still pending and we have a session
    const pendingStatuses = [
      KycApplicationStatus.PENDING,
      KycApplicationStatus.SUBMITTED_TO_PROVIDER,
      KycApplicationStatus.UNDER_REVIEW,
    ];
    if (
      pendingStatuses.includes(profile.status) &&
      profile.providerReference &&
      profile.providerName
    ) {
      try {
        const provider = this.getProviderByName(profile.providerName);
        const fresh = await provider.refreshStatus(profile);
        if (
          fresh.status &&
          fresh.status !== 'UNDER_REVIEW' &&
          fresh.status !== 'PENDING'
        ) {
          this.logger.log('KYC status updated from the configured provider');
          profile.providerStatus = fresh.status;
          profile.providerRawResponse = {};
          this.applyMappedStatus(profile, fresh);
          await profile.save();
          await this.syncUserKycStatus(user, profile);
          // Re-fetch user to get updated kycStatus
          const updatedUser = await this.userModel.findById(user._id).exec();
          return this.toProfileView(profile, updatedUser ?? user);
        }
      } catch {
        this.logger.warn('Automatic KYC status refresh failed');
      }
    }

    return this.toProfileView(profile, user);
  }

  /**
   * User-facing endpoint: explicitly refresh KYC status from provider.
   */
  async syncMyStatus(userId: string): Promise<KycProfileView> {
    const user = await this.findUser(userId);
    const profile = await this.getOrCreateProfileForUser(user._id);

    if (!profile.providerReference || !profile.providerName) {
      return this.toProfileView(profile, user);
    }

    const provider = this.getProviderByName(profile.providerName);
    const status = await provider.refreshStatus(profile);

    // If polling the stored session returns PENDING/UNKNOWN, it may be stale.
    // Update the stored reference then re-apply.
    if (
      status.status === 'PENDING' ||
      status.status === 'UNKNOWN' ||
      status.status === 'UNDER_REVIEW'
    ) {
      this.logger.log('KYC status remains pending at the configured provider');
      return this.toProfileView(profile, user);
    }

    profile.providerStatus = status.status;
    profile.providerRawResponse = {};
    this.applyMappedStatus(profile, status);
    await profile.save();

    await this.syncUserKycStatus(user, profile);
    const updatedUser = await this.userModel.findById(user._id).exec();
    return this.toProfileView(profile, updatedUser ?? user);
  }

  async updateProfile(
    userId: string,
    dto: UpdateKycProfileDto,
  ): Promise<KycProfileView> {
    const user = await this.findUser(userId);
    const profile = await this.getOrCreateProfileForUser(user._id);

    const update: Partial<KycProfile> = {};

    if (dto.firstName !== undefined) update.firstName = dto.firstName;
    if (dto.lastName !== undefined) update.lastName = dto.lastName;
    if (dto.dateOfBirth !== undefined)
      update.dateOfBirth = new Date(dto.dateOfBirth);
    if (dto.nationality !== undefined) update.nationality = dto.nationality;
    if (dto.addressLine1 !== undefined) update.addressLine1 = dto.addressLine1;
    if (dto.addressLine2 !== undefined) update.addressLine2 = dto.addressLine2;
    if (dto.city !== undefined) update.city = dto.city;
    if (dto.stateOrProvince !== undefined)
      update.stateOrProvince = dto.stateOrProvince;
    if (dto.postalCode !== undefined) update.postalCode = dto.postalCode;
    if (dto.country !== undefined) update.country = dto.country;
    if (dto.idType !== undefined) update.idType = dto.idType;
    if (dto.idNumberLast4 !== undefined)
      update.idNumberLast4 = dto.idNumberLast4;
    if (dto.idCountry !== undefined) update.idCountry = dto.idCountry;
    if (dto.idExpiryDate !== undefined)
      update.idExpiryDate = new Date(dto.idExpiryDate);

    if (
      profile.status === KycApplicationStatus.UNVERIFIED ||
      profile.status === KycApplicationStatus.DRAFT ||
      profile.status === KycApplicationStatus.EXPIRED
    ) {
      update.status = KycApplicationStatus.DRAFT;
    }

    const updated = await this.profileModel
      .findByIdAndUpdate(profile._id, { $set: update }, { new: true })
      .exec();

    if (!updated) {
      throw new NotFoundException('KYC profile not found');
    }

    return this.toProfileView(updated, user);
  }

  uploadDocument(
    userId: string,
    dto: UploadKycDocumentDto,
    file: Express.Multer.File | undefined,
  ): Promise<KycDocumentView> {
    void userId;
    void dto;
    void file;
    return Promise.reject(
      new ServiceUnavailableException(
        'Direct KYC document upload is unavailable; use the hosted verification flow.',
      ),
    );
  }

  /**
   * Start the KYC verification flow via the configured provider.
   * For Didit: returns a verificationUrl for redirect.
   * For Laboremus: submits document data directly to the API.
   *
   * `userType` determines the provider:
   *   'INVESTOR'  → Didit (individual KYC)
   *   'CREATOR'   → Laboremus (individual KYC + KYB)
   *   default     → Didit
   */
  async submitForVerification(
    userId: string,
    dto: SubmitKycApplicationDto,
  ): Promise<KycProfileView & { verificationUrl?: string }> {
    const user = await this.findUser(userId);
    const profile = await this.getOrCreateProfileForUser(user._id);

    // Allow re-submission if expired, rejected, needs more info, or still pending
    const allowedStatuses = [
      KycApplicationStatus.UNVERIFIED,
      KycApplicationStatus.DRAFT,
      KycApplicationStatus.REJECTED,
      KycApplicationStatus.NEEDS_MORE_INFO,
      KycApplicationStatus.EXPIRED,
      KycApplicationStatus.UNDER_REVIEW, // allow retry if stuck pending
    ];
    if (!allowedStatuses.includes(profile.status)) {
      throw new BadRequestException(
        `Cannot submit KYC while status is ${profile.status}. ` +
          'If under review, please wait for the result.',
      );
    }

    if (dto.level) profile.level = dto.level;

    const provider = this.selectProvider(dto.userType);

    profile.status = KycApplicationStatus.PENDING;
    profile.submittedAt = new Date();

    let submitResult: KycProviderSubmitResult;
    try {
      submitResult = await provider.submitApplication(profile);
    } catch {
      this.logger.error('KYC provider session creation failed');
      // Reset status back so user can retry
      profile.status = KycApplicationStatus.UNVERIFIED;
      await profile.save();
      throw new BadRequestException(
        'KYC provider session creation failed. Please try again.',
      );
    }

    profile.providerName = provider.getProviderName();
    profile.providerReference = submitResult.reference;
    profile.providerStatus = submitResult.status;
    profile.providerRawResponse = {};

    const mapped = this.mapProviderStatus(submitResult);
    this.applyMappedStatus(profile, mapped);

    await profile.save();
    await this.syncUserKycStatus(user, profile);

    const view = this.toProfileView(profile, user) as KycProfileView & {
      verificationUrl?: string;
    };

    // Return the hosted URL so the frontend can redirect the user
    const verificationUrl = submitResult.rawResponse?.verificationUrl;
    if (typeof verificationUrl === 'string') {
      view.verificationUrl = verificationUrl;
    }

    return view;
  }

  /**
   * Called from the project detail / invest flow to check KYC is valid.
   * Throws ForbiddenException if not verified or expired.
   * Respects KYC_BYPASS env var for development.
   */
  async requireVerified(userId: string): Promise<void> {
    const bypass =
      String(this.configService.get('KYC_BYPASS') ?? '').toLowerCase() ===
      'true';
    if (bypass) return;

    const user = await this.findUser(userId);
    if (user.kycStatus === KYCStatus.VERIFIED) {
      // Also check expiry
      const profile = await this.profileModel
        .findOne({ userId: user._id })
        .exec();
      if (profile) {
        const isExpired = await this.checkAndMarkExpired(profile, user);
        if (!isExpired) return;
      } else {
        return; // trust the user flag
      }
    }

    const statusMsg =
      user.kycStatus === KYCStatus.PENDING
        ? 'Your KYC is still under review. Please wait for approval.'
        : user.kycStatus === KYCStatus.REJECTED
          ? 'Your KYC was rejected. Please re-submit your documents.'
          : 'You must complete identity verification to invest.';

    throw new ForbiddenException(statusMsg);
  }

  // ─────────────────────────────────────────────
  // Webhook handler
  // ─────────────────────────────────────────────

  async handleProviderWebhook(
    providerName: string,
    dto: KycWebhookDto,
    verification: { eventKey: string; eventAt: Date },
  ): Promise<void> {
    try {
      await this.webhookEventModel.create({
        provider: providerName,
        eventKey: verification.eventKey,
        reference: dto.reference,
        status: dto.status,
        eventAt: verification.eventAt,
      });
    } catch (error: unknown) {
      if ((error as { code?: number }).code === 11000) return;
      throw error;
    }

    const provider = this.getProviderByName(providerName);
    const mapped = await provider.handleWebhook(dto);
    if (!mapped) return;

    let profile: KycProfileDocument | null = null;

    // Priority 1: look up by vendor_data (userId) — most reliable for Didit
    const rawVendorData =
      dto.externalUserId ?? dto.payload?.vendor_data ?? dto.payload?.vendorData;
    const vendorData =
      typeof rawVendorData === 'string' ? rawVendorData : undefined;

    if (vendorData && Types.ObjectId.isValid(vendorData)) {
      profile = await this.profileModel
        .findOne({ userId: new Types.ObjectId(vendorData) })
        .exec();
      if (profile) {
        this.logger.log('KYC webhook matched an active profile');
        profile.providerReference = mapped.reference;
        profile.providerName = providerName;
      }
    }

    // Priority 2: fallback to session_id match
    if (!profile && mapped.reference) {
      profile = await this.profileModel
        .findOne({ providerName, providerReference: mapped.reference })
        .exec();
    }

    if (!profile) {
      this.logger.warn(`KYC webhook did not match an active profile`);
      return;
    }

    if (
      profile.providerEventAt &&
      verification.eventAt.getTime() <= profile.providerEventAt.getTime()
    ) {
      return;
    }

    profile.providerStatus = mapped.status;
    profile.providerRawResponse = {};
    profile.providerEventAt = verification.eventAt;
    this.applyMappedStatus(profile, mapped);

    await profile.save();

    const user = await this.userModel.findById(profile.userId).exec();
    if (user) await this.syncUserKycStatus(user, profile);

    await this.auditService.log({
      action: 'kyc.webhook.applied',
      actorId: profile.userId,
      targetType: 'kyc_profile',
      targetId: String(profile._id),
      metadata: { provider: providerName, status: profile.status },
    });
  }

  // ─────────────────────────────────────────────
  // Admin API
  // ─────────────────────────────────────────────

  async adminListProfiles(
    dto: AdminFilterKycDto,
  ): Promise<KycProfileListResponse> {
    const filter: FilterQuery<KycProfileDocument> = {};

    if (dto.status) filter.status = dto.status;
    if (dto.userId) filter.userId = new Types.ObjectId(dto.userId);

    if (dto.fromDate || dto.toDate) {
      filter.submittedAt = {
        ...(dto.fromDate ? { $gte: new Date(dto.fromDate) } : {}),
        ...(dto.toDate ? { $lte: new Date(dto.toDate) } : {}),
      };
    }

    const page = dto.page ?? 1;
    const pageSize = dto.pageSize ?? 20;

    const [profiles, total] = await Promise.all([
      this.profileModel
        .find(filter)
        .sort({ submittedAt: -1 })
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .exec(),
      this.profileModel.countDocuments(filter).exec(),
    ]);

    const userIds = profiles.map((p) => p.userId.toString());
    const users = await this.userModel
      .find({ _id: { $in: userIds } })
      .select('kycStatus email profile')
      .exec();
    const userMap = new Map<string, UserDocument>();
    for (const u of users) userMap.set(u._id.toString(), u as UserDocument);

    const items: AdminKycProfileListItem[] = profiles.map((p) => {
      const user = userMap.get(p.userId.toString());
      const userKycStatus = user?.kycStatus ?? KYCStatus.NOT_VERIFIED;
      // Also get the creator's precise name from profile
      const firstName = user?.profile?.firstName ?? '';
      const lastName = user?.profile?.lastName ?? '';
      const userName =
        [firstName, lastName].filter(Boolean).join(' ').trim() || undefined;

      return {
        id: p._id.toString(),
        userId: p.userId.toString(),
        userEmail: user?.email,
        userName,
        status: p.status,
        userKycStatus,
        level: p.level ?? null,
        submittedAt: p.submittedAt ?? null,
        approvedAt: p.approvedAt ?? null,
        rejectedAt: p.rejectedAt ?? null,
        rejectionReason: p.rejectionReason ?? null,
        documentCount: (p.documents ?? []).length,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      };
    });

    return { items, total, page, pageSize };
  }

  async adminGetProfile(id: string): Promise<KycProfileView> {
    if (!Types.ObjectId.isValid(id))
      throw new BadRequestException('Invalid profile id');
    const profile = await this.profileModel.findById(id).exec();
    if (!profile) throw new NotFoundException('KYC profile not found');
    const user = await this.userModel.findById(profile.userId).exec();
    return this.toProfileView(profile, user ?? undefined);
  }

  async adminOverrideStatus(
    id: string,
    dto: AdminOverrideKycStatusDto,
    actorId: string,
    actorRoles: string[],
  ): Promise<KycProfileView> {
    if (!Types.ObjectId.isValid(id))
      throw new BadRequestException('Invalid profile id');
    const profile = await this.profileModel.findById(id).exec();
    if (!profile) throw new NotFoundException('KYC profile not found');

    profile.status = dto.status;
    profile.rejectionReason = dto.rejectionReason;
    profile.manualNotes = dto.manualNotes;
    if (dto.level) profile.level = dto.level;

    const now = new Date();
    if (dto.status === KycApplicationStatus.APPROVED) {
      profile.approvedAt = now;
      profile.rejectedAt = undefined;
    } else if (dto.status === KycApplicationStatus.REJECTED) {
      profile.rejectedAt = now;
      profile.approvedAt = undefined;
    }

    await profile.save();

    const user = await this.userModel.findById(profile.userId).exec();
    if (user) await this.syncUserKycStatus(user, profile);

    await this.auditService.log({
      action: 'kyc.admin.status_overridden',
      actorId,
      actorRoles,
      targetType: 'kyc_profile',
      targetId: String(profile._id),
      metadata: { status: profile.status },
    });

    return this.toProfileView(profile, user ?? undefined);
  }

  async syncStatusFromProvider(
    id: string,
    actorId: string,
    actorRoles: string[],
  ): Promise<KycProfileView> {
    if (!Types.ObjectId.isValid(id))
      throw new BadRequestException('Invalid profile id');
    const profile = await this.profileModel.findById(id).exec();
    if (!profile) throw new NotFoundException('KYC profile not found');

    const provider = this.getProviderByName(profile.providerName ?? '');
    const status = await provider.refreshStatus(profile);

    profile.providerStatus = status.status;
    profile.providerRawResponse = {};
    this.applyMappedStatus(profile, status);

    await profile.save();

    const user = await this.userModel.findById(profile.userId).exec();
    if (user) await this.syncUserKycStatus(user, profile);
    await this.auditService.log({
      action: 'kyc.admin.provider_sync',
      actorId,
      actorRoles,
      targetType: 'kyc_profile',
      targetId: String(profile._id),
      metadata: { provider: profile.providerName, status: profile.status },
    });
    if (!user) return this.toProfileView(profile);
    return this.toProfileView(profile, user);
  }

  // ─────────────────────────────────────────────
  // Private helpers
  // ─────────────────────────────────────────────

  private selectProvider(
    _userType?: string,
  ): DiditKycProviderService | DummyKycProviderService {
    void _userType;
    const configuredProvider = (
      this.configService.get<string>('KYC_PROVIDER') ?? ''
    ).toLowerCase();

    if (configuredProvider === 'dummy') {
      const environment = this.configService.get<string>('NODE_ENV');
      const mode = this.configService.get<string>('KYC_PROVIDER_MODE');
      if (
        !['development', 'test'].includes(environment || '') ||
        mode !== 'sandbox'
      ) {
        throw new ForbiddenException(
          'Dummy KYC is available only in explicit development/test sandbox mode',
        );
      }
      return this.dummyProvider;
    }

    // Didit handles KYC for ALL user types (investors + creators)
    // Re-add Laboremus for KYB when business verification is needed
    return this.diditProvider;
  }

  private getProviderByName(
    name: string,
  ): DiditKycProviderService | DummyKycProviderService {
    switch (name.toLowerCase()) {
      case 'didit':
        return this.diditProvider;
      default:
        throw new ForbiddenException('Unsupported KYC provider');
    }
  }

  /**
   * Check if an APPROVED profile has passed the 12-month expiry limit,
   * and if so, mark it EXPIRED.
   * Returns true if it was just expired.
   */
  private async checkAndMarkExpired(
    profile: KycProfileDocument,
    user: UserDocument,
  ): Promise<boolean> {
    if (profile.status !== KycApplicationStatus.APPROVED) return false;
    if (!profile.approvedAt) return false;

    const expiresAt = new Date(profile.approvedAt);
    expiresAt.setMonth(expiresAt.getMonth() + KYC_EXPIRY_MONTHS);

    if (new Date() > expiresAt) {
      this.logger.log(
        `KYC expired for user ${profile.userId.toString()}, marking EXPIRED`,
      );
      profile.status = KycApplicationStatus.EXPIRED;
      await profile.save();
      await this.syncUserKycStatus(user, profile);
      return true;
    }

    return false;
  }

  private async getOrCreateProfileForUser(
    userId: Types.ObjectId,
  ): Promise<KycProfileDocument> {
    let profile = await this.profileModel.findOne({ userId }).exec();
    if (!profile) {
      profile = await this.profileModel.create({
        userId,
        status: KycApplicationStatus.UNVERIFIED,
        documents: [],
      });
    }
    return profile;
  }

  private async findUser(userId: string): Promise<UserDocument> {
    if (!Types.ObjectId.isValid(userId))
      throw new BadRequestException('Invalid user id');
    const user = await this.userModel.findById(userId).exec();
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  private async syncUserKycStatus(
    user: UserDocument,
    profile: KycProfileDocument,
  ): Promise<void> {
    let newStatus: KYCStatus = user.kycStatus ?? KYCStatus.NOT_VERIFIED;

    if (profile.status === KycApplicationStatus.APPROVED) {
      newStatus = KYCStatus.VERIFIED;
    } else if (profile.status === KycApplicationStatus.REJECTED) {
      newStatus = KYCStatus.REJECTED;
    } else if (profile.status === KycApplicationStatus.EXPIRED) {
      newStatus = KYCStatus.NOT_VERIFIED;
    } else if (
      [
        KycApplicationStatus.PENDING,
        KycApplicationStatus.SUBMITTED_TO_PROVIDER,
        KycApplicationStatus.UNDER_REVIEW,
      ].includes(profile.status)
    ) {
      newStatus = KYCStatus.PENDING;
    }

    await this.userModel
      .findByIdAndUpdate(user._id, {
        $set: {
          kycStatus: newStatus,
          'kyc.status': newStatus,
          'kyc.submittedAt': profile.submittedAt,
          'kyc.verifiedAt':
            newStatus === KYCStatus.VERIFIED
              ? new Date()
              : user.kyc?.verifiedAt,
          'kyc.failureReason': profile.rejectionReason ?? null,
          'kyc.documentType': profile.idType ?? user.kyc?.documentType,
          'kyc.documentCountry': profile.idCountry ?? user.kyc?.documentCountry,
          'kyc.documentLast4': profile.idNumberLast4 ?? user.kyc?.documentLast4,
        },
      })
      .exec();
  }

  private mapProviderStatus(
    status: KycProviderStatusResult,
  ): KycProviderStatusResult {
    return status;
  }

  private applyMappedStatus(
    profile: KycProfileDocument,
    mapped: KycProviderStatusResult,
  ): void {
    const normalized = mapped.status.toUpperCase();
    const now = new Date();

    if (normalized === 'APPROVED') {
      profile.status = KycApplicationStatus.APPROVED;
      profile.approvedAt = now;
      profile.rejectedAt = undefined;
    } else if (normalized === 'REJECTED') {
      profile.status = KycApplicationStatus.REJECTED;
      profile.rejectedAt = now;
      profile.approvedAt = undefined;
    } else if (['PENDING', 'UNDER_REVIEW', 'SUBMITTED'].includes(normalized)) {
      profile.status = KycApplicationStatus.UNDER_REVIEW;
    } else if (normalized === 'NEEDS_MORE_INFO') {
      profile.status = KycApplicationStatus.NEEDS_MORE_INFO;
    } else if (normalized === 'EXPIRED') {
      profile.status = KycApplicationStatus.EXPIRED;
    }
  }

  private toDocumentView(doc: KycDocument): KycDocumentView {
    return {
      id: undefined,
      type: doc.type,
      label: doc.label,
      storageKey: doc.storageKey,
      url: doc.url,
      mimeType: doc.mimeType,
      sizeBytes: doc.sizeBytes,
      uploadedAt: doc.uploadedAt,
      metadata: doc.metadata,
    };
  }

  private toProfileView(
    profile: KycProfileDocument,
    user?: UserDocument,
  ): KycProfileView {
    const docs = (profile.documents ?? []).map((d) => this.toDocumentView(d));
    const userKycStatus = user?.kycStatus ?? KYCStatus.NOT_VERIFIED;

    return {
      id: profile._id.toString(),
      userId: profile.userId.toString(),
      status: profile.status,
      userKycStatus,
      level: profile.level ?? null,
      firstName: profile.firstName ?? null,
      lastName: profile.lastName ?? null,
      dateOfBirth: profile.dateOfBirth ?? null,
      nationality: profile.nationality ?? null,
      addressLine1: profile.addressLine1 ?? null,
      addressLine2: profile.addressLine2 ?? null,
      city: profile.city ?? null,
      stateOrProvince: profile.stateOrProvince ?? null,
      postalCode: profile.postalCode ?? null,
      country: profile.country ?? null,
      idType: profile.idType ?? null,
      idNumberLast4: profile.idNumberLast4 ?? null,
      idCountry: profile.idCountry ?? null,
      idExpiryDate: profile.idExpiryDate ?? null,
      providerName: profile.providerName ?? null,
      providerReference: profile.providerReference ?? null,
      providerStatus: profile.providerStatus ?? null,
      submittedAt: profile.submittedAt ?? null,
      approvedAt: profile.approvedAt ?? null,
      rejectedAt: profile.rejectedAt ?? null,
      rejectionReason: profile.rejectionReason ?? null,
      manualNotes: profile.manualNotes ?? null,
      documents: docs,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    };
  }
}
