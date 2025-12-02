import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '../../../common/swagger.decorators';
import { UsersService } from '../users.service';
import { CreateUserDto } from '../dto/create-user.dto';
import { UpdateProfileDto } from '../dto/update-profile.dto';
import { LinkWalletDto } from '../dto/link-wallet.dto';
import { UpdateRoleDto } from '../dto/update-role.dto';
import { UpdateKycStatusDto } from '../dto/update-kyc-status.dto';
import { BlockUserDto } from '../dto/block-user.dto';
import { QueryUsersDto } from '../dto/query-users.dto';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { UserRole } from '../../../common/enums/role.enum';
import { Permissions } from '../../../common/decorators/permissions.decorator';
import { Permission } from '../../../common/enums/permission.enum';
import { RoleMetadataOr } from '../../../common/decorators/role-or.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { SignupUserDto } from '../dto/signup-user.dto';
import { SubmitKycDto } from '../dto/submit-kyc.dto';
import { SubmitCreatorVerificationDto } from '../dto/submit-creator-verification.dto';
import { UpdateCreatorVerificationDto } from '../dto/update-creator-verification.dto';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Public()
  @Post('signup')
  signup(@Body() dto: SignupUserDto) {
    return this.usersService.signup(dto);
  }

  @Post()
  @RoleMetadataOr(UserRole.ADMIN)
  @Permissions(Permission.MANAGE_USERS)
  createUser(@Body() dto: CreateUserDto) {
    return this.usersService.createUser(dto);
  }

  @Get('me')
  getCurrentUser(@CurrentUser('sub') userId: string) {
    return this.usersService.getUserById(userId);
  }

  @Get()
  @RoleMetadataOr(UserRole.ADMIN)
  @Permissions(Permission.MANAGE_USERS)
  listUsers(@Query() query: QueryUsersDto) {
    return this.usersService.listUsers(query);
  }

  @Get(':id')
  @RoleMetadataOr(UserRole.ADMIN)
  @Permissions(Permission.MANAGE_USERS)
  getUser(@Param('id') id: string) {
    return this.usersService.getUserById(id);
  }

  @Patch('me/profile')
  updateProfile(
    @CurrentUser('sub') userId: string,
    @Body() dto: UpdateProfileDto,
  ) {
    return this.usersService.updateProfile(userId, dto);
  }

  @Patch('me/kyc')
  submitKyc(@CurrentUser('sub') userId: string, @Body() dto: SubmitKycDto) {
    return this.usersService.submitKyc(userId, dto);
  }

  @Patch('me/creator-verification')
  submitCreatorVerification(
    @CurrentUser('sub') userId: string,
    @Body() dto: SubmitCreatorVerificationDto,
  ) {
    return this.usersService.submitCreatorVerification(userId, dto);
  }

  @Patch(':id/profile')
  @RoleMetadataOr(UserRole.ADMIN)
  @Permissions(Permission.MANAGE_USERS)
  adminUpdateProfile(@Param('id') id: string, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateProfile(id, dto);
  }

  @Post('me/wallets')
  linkWallet(@CurrentUser('sub') userId: string, @Body() dto: LinkWalletDto) {
    return this.usersService.linkWallet(userId, dto);
  }

  @Delete('me/wallets/:wallet')
  unlinkWallet(
    @CurrentUser('sub') userId: string,
    @Param('wallet') wallet: string,
  ) {
    return this.usersService.unlinkWallet(userId, { wallet });
  }

  @Patch(':id/role')
  @RoleMetadataOr(UserRole.ADMIN)
  @Permissions(Permission.MANAGE_USERS)
  updateRole(@Param('id') id: string, @Body() dto: UpdateRoleDto) {
    return this.usersService.updateRole(id, dto);
  }

  @Patch(':id/kyc')
  @RoleMetadataOr(UserRole.ADMIN)
  @Permissions(Permission.MANAGE_USERS)
  updateKyc(@Param('id') id: string, @Body() dto: UpdateKycStatusDto) {
    return this.usersService.updateKycStatus(id, dto);
  }

  @Patch(':id/creator-verification')
  @RoleMetadataOr(UserRole.ADMIN)
  @Permissions(Permission.MANAGE_USERS)
  updateCreatorVerification(
    @Param('id') id: string,
    @Body() dto: UpdateCreatorVerificationDto,
  ) {
    return this.usersService.updateCreatorVerificationStatus(id, dto);
  }

  @Patch(':id/block')
  @RoleMetadataOr(UserRole.ADMIN)
  @Permissions(Permission.MANAGE_USERS)
  blockUser(@Param('id') id: string, @Body() dto: BlockUserDto) {
    return this.usersService.blockUser(id, dto);
  }
}
