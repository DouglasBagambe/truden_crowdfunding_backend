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
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { UserRole } from '../../../common/enums/role.enum';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @Roles(UserRole.ADMIN)
  createUser(@Body() dto: CreateUserDto) {
    return this.usersService.createUser(dto);
  }

  @Get('me')
  getCurrentUser(@CurrentUser('sub') userId: string) {
    return this.usersService.getUserById(userId);
  }

  @Get()
  @Roles(UserRole.ADMIN)
  listUsers(@Query() query: QueryUsersDto) {
    return this.usersService.listUsers(query);
  }

  @Get(':id')
  @Roles(UserRole.ADMIN)
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

  @Patch(':id/profile')
  @Roles(UserRole.ADMIN)
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
  @Roles(UserRole.ADMIN)
  updateRole(@Param('id') id: string, @Body() dto: UpdateRoleDto) {
    return this.usersService.updateRole(id, dto);
  }

  @Patch(':id/kyc')
  @Roles(UserRole.ADMIN)
  updateKyc(@Param('id') id: string, @Body() dto: UpdateKycStatusDto) {
    return this.usersService.updateKycStatus(id, dto);
  }

  @Patch(':id/block')
  @Roles(UserRole.ADMIN)
  blockUser(@Param('id') id: string, @Body() dto: BlockUserDto) {
    return this.usersService.blockUser(id, dto);
  }
}
