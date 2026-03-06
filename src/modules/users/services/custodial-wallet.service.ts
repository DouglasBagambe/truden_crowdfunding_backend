import {
    BadRequestException,
    Injectable,
    Logger,
    InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as crypto from 'crypto';
import {
    createWalletClient,
    createPublicClient,
    http,
    type Chain,
    type Hash,
    type Abi,
} from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { User, UserDocument } from '../schemas/user.schema';

type Hex = `0x${string}`;

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

@Injectable()
export class CustodialWalletService {
    private readonly logger = new Logger(CustodialWalletService.name);
    private readonly masterKey: Buffer;

    constructor(
        @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
        private readonly configService: ConfigService,
    ) {
        const keyHex = this.configService.get<string>('CUSTODIAL_WALLET_MASTER_KEY') ?? '';
        if (!keyHex) {
            this.logger.warn(
                'CUSTODIAL_WALLET_MASTER_KEY not set. Custodial wallet encryption will use a fallback key. SET THIS IN PRODUCTION.',
            );
        }
        // Derive a 32-byte key regardless of input length
        const raw = keyHex || 'keibo-crowdfunding-default-dev-key-unsafe';
        this.masterKey = crypto.createHash('sha256').update(raw).digest();
    }

    // ─── Encryption helpers ────────────────────────────────────────────

    private encryptKey(privateKey: string): string {
        const iv = crypto.randomBytes(IV_LENGTH);
        const cipher = crypto.createCipheriv(ALGORITHM, this.masterKey, iv);
        const encrypted = Buffer.concat([
            cipher.update(privateKey, 'utf8'),
            cipher.final(),
        ]);
        const tag = cipher.getAuthTag();
        // Format: iv(hex):tag(hex):encrypted(hex)
        return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
    }

    private decryptKey(encrypted: string): string {
        const parts = encrypted.split(':');
        if (parts.length !== 3) throw new InternalServerErrorException('Invalid encrypted key format');
        const [ivHex, tagHex, dataHex] = parts;
        const iv = Buffer.from(ivHex, 'hex');
        const tag = Buffer.from(tagHex, 'hex');
        const data = Buffer.from(dataHex, 'hex');
        const decipher = crypto.createDecipheriv(ALGORITHM, this.masterKey, iv);
        decipher.setAuthTag(tag);
        return decipher.update(data).toString('utf8') + decipher.final('utf8');
    }

    // ─── Public API ────────────────────────────────────────────────────

    /**
     * Returns the user's custodial EVM address (creates one if not yet generated).
     */
    async getOrCreateWallet(userId: string): Promise<{ address: string }> {
        const user = await this.userModel
            .findById(userId)
            .select('+custodialWalletKeyEncrypted')
            .exec();

        if (!user) throw new BadRequestException('User not found');

        if (user.custodialWalletAddress && user.custodialWalletKeyEncrypted) {
            return { address: user.custodialWalletAddress };
        }

        return this.generateWallet(user);
    }

    /**
     * Returns the plain address only (safe to expose to frontend).
     */
    async getCustodialAddress(userId: string): Promise<string | null> {
        const user = await this.userModel.findById(userId).select('custodialWalletAddress').exec();
        return user?.custodialWalletAddress ?? null;
    }

    /**
     * Signs and broadcasts an EVM transaction using the user's custodial key.
     * Use this for on-chain operations on the user's behalf.
     * @param userId - user whose custodial key to use
     * @param buildTx - callback receives the walletClient and account, returns the tx hash
     */
    async signAndSend(
        userId: string,
        buildTx: (walletClient: ReturnType<typeof createWalletClient>, account: ReturnType<typeof privateKeyToAccount>) => Promise<Hash>,
    ): Promise<Hash> {
        const user = await this.userModel
            .findById(userId)
            .select('+custodialWalletKeyEncrypted')
            .exec();

        if (!user?.custodialWalletKeyEncrypted) {
            throw new BadRequestException('Custodial wallet not found for user');
        }

        const rawKey = this.decryptKey(user.custodialWalletKeyEncrypted);
        const normalizedKey = (rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as Hex;
        const account = privateKeyToAccount(normalizedKey);

        const { chain, rpcUrl } = this.getChainConfig();
        const walletClient = createWalletClient({ chain, transport: http(rpcUrl), account });

        return buildTx(walletClient, account);
    }

    // ─── Private helpers ───────────────────────────────────────────────

    private async generateWallet(user: UserDocument): Promise<{ address: string }> {
        const privateKey = generatePrivateKey(); // returns `0x${string}`
        const account = privateKeyToAccount(privateKey);
        const address = account.address.toLowerCase();

        user.custodialWalletAddress = address;
        user.custodialWalletKeyEncrypted = this.encryptKey(privateKey);
        await user.save();

        this.logger.log(`Custodial wallet created for user ${user._id}: ${address}`);
        return { address };
    }

    private getChainConfig(): { chain: Chain; rpcUrl: string } {
        const rpcUrl = this.configService.get<string>('blockchain.rpcUrl') ?? '';
        const chainId = this.configService.get<number>('blockchain.chainId') ?? 1;
        const chain: Chain = {
            id: chainId,
            name: 'CrowdfundingChain',
            nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
            rpcUrls: {
                default: { http: [rpcUrl] },
                public: { http: [rpcUrl] },
            },
        };
        return { chain, rpcUrl };
    }
}
