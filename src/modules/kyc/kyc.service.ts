import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
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
import { KycProviderStatusResult } from './providers/kyc-provider.interface';
import { DummyKycProviderService } from './providers/dummy-kyc.provider';

@Injectable()
export class KycService {
  constructor(
    @InjectModel(KycProfile.name)
    private readonly profileModel: Model<KycProfileDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly provider: DummyKycProviderService,
  ) {}

  async getProfileForUser(userId: string): Promise<KycProfileView> {
    const user = await this.findUser(userId);
    const profile = await this.getOrCreateProfileForUser(user._id);
    return this.toProfileView(profile, user);
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
      profile.status === KycApplicationStatus.DRAFT
    ) {
      (update as any).status = KycApplicationStatus.DRAFT;
    }

    const updated = await this.profileModel
      .findByIdAndUpdate(profile._id, { $set: update }, { new: true })
      .exec();

    if (!updated) {
      throw new NotFoundException('KYC profile not found');
    }

    return this.toProfileView(updated, user);
  }

  async uploadDocument(
    userId: string,
    dto: UploadKycDocumentDto,
    file: Express.Multer.File | undefined,
  ): Promise<KycDocumentView> {
    if (!file) {
      throw new BadRequestException('File is required');
    }

    const user = await this.findUser(userId);
    const profile = await this.getOrCreateProfileForUser(user._id);

    const storageKey = `kyc/${user._id.toString()}/${Date.now()}-${
      file.originalname
    }`;

    const doc: KycDocument = {
      type: dto.type,
      label: dto.label,
      storageKey,
      url: storageKey,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      uploadedAt: new Date(),
      metadata: dto.metadata,
    };

    profile.documents.push(doc);
    await profile.save();

    const reloaded = await this.profileModel.findById(profile._id).exec();
    if (!reloaded) {
      throw new NotFoundException('KYC profile not found');
    }

    const savedDoc = reloaded.documents[reloaded.documents.length - 1];
    return this.toDocumentView(savedDoc);
  }

  async submitForVerification(
    userId: string,
    dto: SubmitKycApplicationDto,
  ): Promise<KycProfileView> {
    const user = await this.findUser(userId);
    const profile = await this.getOrCreateProfileForUser(user._id);

    if (!profile.country || !profile.idType) {
      throw new BadRequestException(
        'KYC profile must include country and idType before submission',
      );
    }

    if (!profile.documents || profile.documents.length === 0) {
      throw new BadRequestException('At least one KYC document is required');
    }

    profile.status = KycApplicationStatus.PENDING;
    profile.submittedAt = new Date();

    if (dto.level) {
      profile.level = dto.level;
    }

    const submitResult = await this.provider.submitApplication(profile);

    profile.providerName = this.provider.getProviderName();
    profile.providerReference = submitResult.reference;
    profile.providerStatus = submitResult.status;
    profile.providerRawResponse = submitResult.rawResponse;

    const mapped = this.mapProviderStatus(submitResult);
    this.applyMappedStatus(profile, mapped);

    await profile.save();

    await this.syncUserKycStatus(user, profile);

    return this.toProfileView(profile, user);
  }

  async handleProviderWebhook(
    providerName: string,
    dto: KycWebhookDto,
  ): Promise<void> {
    const profile = await this.profileModel
      .findOne({ providerName, providerReference: dto.reference })
      .exec();
    if (!profile) {
      return;
    }

    const mapped = await this.provider.handleWebhook(dto);
    if (!mapped) {
      return;
    }

    profile.providerStatus = mapped.status;
    profile.providerRawResponse = mapped.rawResponse;

    this.applyMappedStatus(profile, mapped);

    await profile.save();

    const user = await this.userModel.findById(profile.userId).exec();
    if (user) {
      await this.syncUserKycStatus(user, profile);
    }
  }

  async adminListProfiles(
    dto: AdminFilterKycDto,
  ): Promise<KycProfileListResponse> {
    const filter: FilterQuery<KycProfileDocument> = {};

    if (dto.status) {
      filter.status = dto.status;
    }

    if (dto.userId) {
      filter.userId = new Types.ObjectId(dto.userId);
    }

    if (dto.fromDate || dto.toDate) {
      filter.submittedAt = {} as any;
      if (dto.fromDate) (filter.submittedAt as any).$gte = new Date(dto.fromDate);
      if (dto.toDate) (filter.submittedAt as any).$lte = new Date(dto.toDate);
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
      .select('kycStatus')
      .exec();
    const userMap = new Map<string, UserDocument>();
    for (const u of users) {
      userMap.set(u._id.toString(), u as UserDocument);
    }

    const items: AdminKycProfileListItem[] = profiles.map((p) => {
      const user = userMap.get(p.userId.toString());
      const userKycStatus = user?.kycStatus ?? KYCStatus.NOT_VERIFIED;
      return {
        id: p._id.toString(),
        userId: p.userId.toString(),
        status: p.status,
        userKycStatus,
        level: (p.level as any) ?? null,
        submittedAt: p.submittedAt ?? null,
        approvedAt: p.approvedAt ?? null,
        rejectedAt: p.rejectedAt ?? null,
        rejectionReason: p.rejectionReason ?? null,
        documentCount: (p.documents ?? []).length,
        createdAt: p.createdAt as Date,
        updatedAt: p.updatedAt as Date,
      };
    });

    return {
      items,
      total,
      page,
      pageSize,
    };
  }

  async adminGetProfile(id: string): Promise<KycProfileView> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid profile id');
    }
    const profile = await this.profileModel.findById(id).exec();
    if (!profile) {
      throw new NotFoundException('KYC profile not found');
    }
    const user = await this.userModel.findById(profile.userId).exec();
    return this.toProfileView(profile, user ?? undefined);
  }

  async adminOverrideStatus(
    id: string,
    dto: AdminOverrideKycStatusDto,
  ): Promise<KycProfileView> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid profile id');
    }
    const profile = await this.profileModel.findById(id).exec();
    if (!profile) {
      throw new NotFoundException('KYC profile not found');
    }

    profile.status = dto.status;
    profile.rejectionReason = dto.rejectionReason;
    profile.manualNotes = dto.manualNotes;
    if (dto.level) {
      profile.level = dto.level;
    }

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
    if (user) {
      await this.syncUserKycStatus(user, profile);
    }

    return this.toProfileView(profile, user ?? undefined);
  }

  async syncStatusFromProvider(id: string): Promise<KycProfileView> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid profile id');
    }
    const profile = await this.profileModel.findById(id).exec();
    if (!profile) {
      throw new NotFoundException('KYC profile not found');
    }

    const status = await this.provider.refreshStatus(profile);
    profile.providerStatus = status.status;
    profile.providerRawResponse = status.rawResponse;

    this.applyMappedStatus(profile, status);

    await profile.save();

    const user = await this.userModel.findById(profile.userId).exec();
    if (!user) {
      return this.toProfileView(profile);
    }
    await this.syncUserKycStatus(user, profile);
    return this.toProfileView(profile, user);
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
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid user id');
    }
    const user = await this.userModel.findById(userId).exec();
    if (!user) {
      throw new NotFoundException('User not found');
    }
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
    } else if (
      profile.status === KycApplicationStatus.PENDING ||
      profile.status === KycApplicationStatus.SUBMITTED_TO_PROVIDER ||
      profile.status === KycApplicationStatus.UNDER_REVIEW
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
            newStatus === KYCStatus.VERIFIED ? new Date() : user.kyc.verifiedAt,
          'kyc.failureReason': profile.rejectionReason ?? null,
          'kyc.documentType': profile.idType ?? user.kyc.documentType,
          'kyc.documentCountry': profile.idCountry ?? user.kyc.documentCountry,
          'kyc.documentLast4':
            profile.idNumberLast4 ?? user.kyc.documentLast4,
        },
      })
      .exec();
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
      level: (profile.level as any) ?? null,
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
      createdAt: profile.createdAt as Date,
      updatedAt: profile.updatedAt as Date,
    };
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
    } else if (
      normalized === 'PENDING' ||
      normalized === 'UNDER_REVIEW' ||
      normalized === 'SUBMITTED'
    ) {
      profile.status = KycApplicationStatus.UNDER_REVIEW;
    } else if (normalized === 'NEEDS_MORE_INFO') {
      profile.status = KycApplicationStatus.NEEDS_MORE_INFO;
    }
  }
}
