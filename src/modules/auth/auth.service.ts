import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { SiweMessage } from 'siwe';
import { randomBytes } from 'crypto';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { SiweVerifyDto } from './dto/siwe.dto';
import { LinkWalletDto } from './dto/link-wallet.dto';
import { JwtPayload } from '../../common/interfaces/user.interface';
import { UserRole } from '../../common/enums/role.enum';
import { User, UserDocument } from '../users/schemas/user.schema';

@Injectable()
export class AuthService {
  private nonceStore: Map<string, { nonce: string; timestamp: number }> = new Map();

  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  async register(registerDto: RegisterDto) {
    const { email, password, firstName, lastName, role } = registerDto;

    const existingUser = await this.userModel
      .findOne({ email: email.toLowerCase() })
      .exec();
    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await this.userModel.create({
      email: email.toLowerCase(),
      password: hashedPassword,
      roles: role ? [role] : [UserRole.INVESTOR],
      isActive: true,
      isBlocked: false,
      profile: {
        firstName,
        lastName,
        displayName:
          [firstName, lastName].filter(Boolean).join(' ').trim() || email,
      },
    });

    const tokens = await this.generateTokens(user);

    return {
      user: this.sanitizeUser(user),
      ...tokens,
    };
  }

  async login(loginDto: LoginDto) {
    const { email, password } = loginDto;

    const user = await this.userModel
      .findOne({ email: email.toLowerCase() })
      .select('+password')
      .exec();
    if (!user || !user.password) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.isActive || user.isBlocked) {
      throw new UnauthorizedException('Account is deactivated');
    }

    await this.userModel
      .findByIdAndUpdate(user._id, { lastLoginAt: new Date() })
      .exec();

    const tokens = await this.generateTokens(user);

    return {
      user: this.sanitizeUser(user),
      ...tokens,
    };
  }

  async generateSiweNonce(address: string): Promise<string> {
    const nonce = randomBytes(16).toString('hex');
    this.nonceStore.set(address.toLowerCase(), {
      nonce,
      timestamp: Date.now(),
    });
    return nonce;
  }

  async verifySiwe(siweVerifyDto: SiweVerifyDto) {
    const { message, signature } = siweVerifyDto;

    try {
      const siweMessage = new SiweMessage(message);
      const fields = await siweMessage.verify({ signature });

      if (!fields.success) {
        throw new UnauthorizedException('Invalid signature');
      }

      const walletAddress = siweMessage.address;

      const isNonceValid = this.verifyNonce(walletAddress, siweMessage.nonce);

      if (!isNonceValid) {
        throw new UnauthorizedException('Invalid or expired nonce');
      }

      let user = await this.userModel
        .findOne({ primaryWallet: walletAddress.toLowerCase() })
        .exec();

      if (!user) {
        user = await this.userModel.create({
          primaryWallet: walletAddress.toLowerCase(),
          roles: [UserRole.INVESTOR],
          isActive: true,
          isBlocked: false,
        });
      } else if (!user.isActive || user.isBlocked) {
        throw new UnauthorizedException('Account is deactivated');
      }

      await this.userModel
        .findByIdAndUpdate(user._id, { lastLoginAt: new Date() })
        .exec();

      const tokens = await this.generateTokens(user);

      return {
        user: this.sanitizeUser(user),
        ...tokens,
      };
    } catch (error) {
      throw new UnauthorizedException('SIWE verification failed: ' + error.message);
    }
  }

  async linkWallet(userId: string, linkWalletDto: LinkWalletDto) {
    const { walletAddress, message, signature } = linkWalletDto;

    try {
      const siweMessage = new SiweMessage(message);
      const fields = await siweMessage.verify({ signature });

      if (!fields.success || siweMessage.address.toLowerCase() !== walletAddress.toLowerCase()) {
        throw new BadRequestException('Invalid signature or address mismatch');
      }

      const targetUser = await this.userModel.findById(userId).exec();
      if (!targetUser || !targetUser.isActive || targetUser.isBlocked) {
        throw new BadRequestException('User not found or inactive');
      }

      const existingUser = await this.userModel
        .findOne({
          $or: [
            { primaryWallet: walletAddress.toLowerCase() },
            { linkedWallets: walletAddress.toLowerCase() },
          ],
        })
        .exec();
      if (existingUser && (existingUser._id as any).toString() !== userId) {
        throw new BadRequestException('Wallet already linked to another account');
      }

      const updatedUser = await this.userModel
        .findByIdAndUpdate(
          userId,
          {
            primaryWallet: walletAddress.toLowerCase(),
            $addToSet: { linkedWallets: walletAddress.toLowerCase() },
          },
          { new: true },
        )
        .exec();

      if (!updatedUser) {
        throw new BadRequestException('User not found');
      }

      return {
        user: this.sanitizeUser(updatedUser),
        message: 'Wallet linked successfully',
      };
    } catch (error) {
      throw new BadRequestException('Failed to link wallet: ' + error.message);
    }
  }

  async getProfile(userId: string) {
    const user = await this.userModel.findById(userId).exec();
    if (!user || !user.isActive || user.isBlocked) {
      throw new UnauthorizedException('User not found or inactive');
    }
    return this.sanitizeUser(user);
  }

  async refreshToken(refreshToken: string) {
    try {
      const payload = this.jwtService.verify(refreshToken, {
        secret: this.configService.get<string>('REFRESH_TOKEN_SECRET'),
      });

      const user = await this.userModel.findById(payload.sub).exec();
      if (!user || !user.isActive || user.isBlocked) {
        throw new UnauthorizedException('User not found or inactive');
      }

      const tokens = await this.generateTokens(user);
      return tokens;
    } catch (error) {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  private async generateTokens(user: UserDocument) {
    const roles = Array.isArray(user.roles) ? user.roles : [];
    const payload: JwtPayload = {
      sub: (user._id as any).toString(),
      email: user.email,
      primaryWallet: user.primaryWallet,
      walletAddress: user.primaryWallet,
      roles,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload as any, {
        secret: this.configService.get<string>('JWT_SECRET'),
        expiresIn: this.configService.get<string>('JWT_EXPIRY') || '15m',
      } as any),
      this.jwtService.signAsync(payload as any, {
        secret: this.configService.get<string>('REFRESH_TOKEN_SECRET'),
        expiresIn: this.configService.get<string>('REFRESH_TOKEN_EXPIRY') || '7d',
      } as any),
    ]);

    return {
      accessToken,
      refreshToken,
    };
  }

  private verifyNonce(address: string, nonce: string): boolean {
    const stored = this.nonceStore.get(address.toLowerCase());
    if (!stored) return false;

    const isExpired = Date.now() - stored.timestamp > 5 * 60 * 1000;
    if (isExpired) {
      this.nonceStore.delete(address.toLowerCase());
      return false;
    }

    const isValid = stored.nonce === nonce;
    if (isValid) {
      this.nonceStore.delete(address.toLowerCase());
    }

    return isValid;
  }

  private sanitizeUser(user: UserDocument) {
    const userObj = user.toObject();
    const { password, nonce, __v, ...sanitized } = userObj;
    const primaryWallet = userObj.primaryWallet;
    return {
      ...sanitized,
      roles: Array.isArray(userObj.roles) ? userObj.roles : [],
      walletAddress: primaryWallet,
      id: (user._id as any).toString(),
    };
  }
}
