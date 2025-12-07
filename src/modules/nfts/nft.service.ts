import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { parseEventLogs, type TransactionReceipt } from 'viem';
import { Nft, NftDocument } from './schemas/nft.schema';
import { MintNftDto } from './dto/mint-nft.dto';
import { UpdateValuationDto } from './dto/update-valuation.dto';
import { ViemNftClient } from './helpers/viem-nft-client';
import type { NftMetadataView, NftView } from './interfaces/nft.interface';
import { UserRole } from '../../common/enums/role.enum';
import type { JwtPayload } from '../../common/interfaces/user.interface';
import { ProjectsService } from '../projects/projects.service';

@Injectable()
export class NftService {
  constructor(
    @InjectModel(Nft.name)
    private readonly nftModel: Model<NftDocument>,
    private readonly viemNftClient: ViemNftClient,
    private readonly projectsService: ProjectsService,
  ) {}

  private parseObjectId(id: string, fieldName: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException(`Invalid ${fieldName}`);
    }
    return new Types.ObjectId(id);
  }

  private ensureAdmin(currentUser: JwtPayload) {
    const roles = currentUser.roles ?? [];
    if (!roles.includes(UserRole.ADMIN)) {
      throw new ForbiddenException('Only admins can perform this action');
    }
  }

  private toView(
    doc: NftDocument,
    options?: { metadata?: NftMetadataView; projectName?: string },
  ): NftView {
    const createdAt =
      (doc as NftDocument & { createdAt?: Date }).createdAt ?? new Date();
    const updatedAt =
      (doc as NftDocument & { updatedAt?: Date }).updatedAt ?? createdAt;

    const baseMetadata: NftMetadataView = {
      name: `Investment NFT #${doc.tokenId}`,
      description: `Represents investment stake in project ${doc.projectId.toHexString()}`,
      attributes: [
        { trait_type: 'Project ID', value: doc.projectId.toHexString() },
        { trait_type: 'Amount Invested', value: doc.amountInvested },
        { trait_type: 'Investor Wallet', value: doc.walletAddress },
      ],
    };

    const metadata = options?.metadata ?? baseMetadata;

    return {
      id: doc._id.toHexString(),
      tokenId: doc.tokenId,
      projectId: doc.projectId.toHexString(),
      investorId: doc.investorId.toHexString(),
      walletAddress: doc.walletAddress,
      amountInvested: doc.amountInvested,
      metadataUri: doc.metadataUri,
      value: doc.value,
      txHash: doc.txHash,
      createdAt,
      updatedAt,
      project: {
        id: doc.projectId.toHexString(),
        name: options?.projectName,
      },
      investor: {
        id: doc.investorId.toHexString(),
        walletAddress: doc.walletAddress,
      },
      metadata,
    };
  }

  private async buildMetadata(params: {
    tokenId: number;
    projectId: string;
    projectName?: string;
    amountInvested: number;
    walletAddress: string;
  }): Promise<NftMetadataView> {
    const nameBase = `Investment NFT #${params.tokenId}`;
    const fullName = params.projectName
      ? `${nameBase} - ${params.projectName}`
      : nameBase;

    const description = params.projectName
      ? `Represents investment stake in ${params.projectName} project.`
      : `Represents investment stake in project ${params.projectId}.`;

    return {
      name: fullName,
      description,
      attributes: [
        { trait_type: 'Project ID', value: params.projectId },
        { trait_type: 'Amount Invested', value: params.amountInvested },
        { trait_type: 'Investor Wallet', value: params.walletAddress },
      ],
    };
  }

  private async saveMetadataToIPFS(metadata: NftMetadataView): Promise<string> {
    const payload = JSON.stringify(metadata);
    const hash = Buffer.from(payload).toString('base64url');
    return `ipfs://mock/${hash}`;
  }

  private parseMintEvent(receipt: TransactionReceipt): number {
    const logs = parseEventLogs({
      abi: this.viemNftClient.getAbi(),
      logs: receipt.logs,
      eventName: 'Transfer',
    });

    if (logs.length === 0) {
      throw new BadRequestException('Unable to parse mint event logs');
    }

    const zeroAddress = '0x0000000000000000000000000000000000000000';

    const mintLog =
      logs.find((log) => {
        const args = log.args as { from?: string };
        return (
          typeof args.from === 'string' &&
          args.from.toLowerCase() === zeroAddress
        );
      }) ?? logs[0];

    const args = mintLog.args as { tokenId?: bigint };
    if (args.tokenId === undefined) {
      throw new BadRequestException('Mint event missing tokenId');
    }

    return Number(args.tokenId);
  }

  async mintNft(dto: MintNftDto, currentUser: JwtPayload): Promise<NftView> {
    this.ensureAdmin(currentUser);

    const amountNumber = Number(dto.amountInvested);
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
      throw new BadRequestException('Invalid amountInvested');
    }

    const projectObjectId = this.parseObjectId(dto.projectId, 'projectId');
    const investorObjectId = this.parseObjectId(dto.investorId, 'investorId');
    const wallet = dto.walletAddress.toLowerCase();

    const project = await this.projectsService.ensureProjectExists(dto.projectId);

    const amountWei = BigInt(Math.floor(amountNumber * 1e18));

    const { hash, receipt } = await this.viemNftClient.mintInvestmentNft({
      to: wallet as `0x${string}`,
      projectId: dto.projectId,
      amount: amountWei,
    });

    const tokenId = this.parseMintEvent(receipt);

    const projectName: string | undefined =
      (project as any).name ?? (project as any).title;

    const metadata = await this.buildMetadata({
      tokenId,
      projectId: dto.projectId,
      projectName,
      amountInvested: amountNumber,
      walletAddress: wallet,
    });

    const metadataUri = await this.saveMetadataToIPFS(metadata);

    const nft = await this.nftModel.create({
      tokenId,
      projectId: projectObjectId,
      investorId: investorObjectId,
      walletAddress: wallet,
      amountInvested: amountNumber,
      metadataUri,
      value: amountNumber,
      txHash: hash,
    });

    return this.toView(nft, { metadata, projectName });
  }

  async updateNFTValue(
    id: string,
    dto: UpdateValuationDto,
    currentUser: JwtPayload,
  ): Promise<NftView> {
    this.ensureAdmin(currentUser);

    const nft = await this.nftModel
      .findById(this.parseObjectId(id, 'id'))
      .exec();

    if (!nft) {
      throw new NotFoundException('NFT not found');
    }

    nft.value = dto.value;
    await nft.save();

    return this.toView(nft);
  }

  async findByWallet(walletAddress: string): Promise<NftView[]> {
    const normalized = walletAddress.toLowerCase();

    const nfts = await this.nftModel
      .find({ walletAddress: normalized })
      .sort({ createdAt: -1 })
      .exec();

    return nfts.map((nft) => this.toView(nft));
  }

  async findByProject(projectId: string): Promise<NftView[]> {
    const projectObjectId = this.parseObjectId(projectId, 'projectId');

    const nfts = await this.nftModel
      .find({ projectId: projectObjectId })
      .sort({ createdAt: -1 })
      .exec();

    return nfts.map((nft) => this.toView(nft));
  }

  async findOneByTokenId(tokenId: number): Promise<NftView> {
    const nft = await this.nftModel.findOne({ tokenId }).exec();

    if (!nft) {
      throw new NotFoundException('NFT not found');
    }

    return this.toView(nft);
  }

  async findOne(id: string): Promise<NftView> {
    const nft = await this.nftModel
      .findById(this.parseObjectId(id, 'id'))
      .exec();

    if (!nft) {
      throw new NotFoundException('NFT not found');
    }

    return this.toView(nft);
  }
}
