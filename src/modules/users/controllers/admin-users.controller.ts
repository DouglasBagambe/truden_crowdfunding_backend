import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiTags } from '../../../common/swagger.decorators';
import { Permission } from '../../../common/enums/permission.enum';
import { Permissions } from '../../../common/decorators/permissions.decorator';
import { RoleMetadataOr } from '../../../common/decorators/role-or.decorator';
import { UserRole } from '../../../common/enums/role.enum';
import { UsersService } from '../users.service';
import { QueryUsersDto } from '../dto/query-users.dto';
import { BlockUserDto } from '../dto/block-user.dto';
import { UpdateRoleDto } from '../dto/update-role.dto';
import { UpdateKycStatusDto } from '../dto/update-kyc-status.dto';

@ApiTags('Admin Users')
@Controller('admin/users')
@RoleMetadataOr(UserRole.ADMIN)
@Permissions(Permission.MANAGE_USERS)
export class AdminUsersController {
    constructor(private readonly usersService: UsersService) { }

    /** List all users with optional filters */
    @Get()
    listUsers(@Query() query: QueryUsersDto) {
        return this.usersService.listUsers(query);
    }

    /** Get a single user by ID */
    @Get(':id')
    getUser(@Param('id') id: string) {
        return this.usersService.getUserById(id);
    }

    /** Block or unblock a user */
    @Patch(':id/block')
    blockUser(@Param('id') id: string, @Body() dto: BlockUserDto) {
        return this.usersService.blockUser(id, dto, 'admin', ['ADMIN']);
    }

    /** Change a user's role */
    @Patch(':id/role')
    updateRole(@Param('id') id: string, @Body() dto: UpdateRoleDto) {
        return this.usersService.updateRole(id, dto, 'admin', ['ADMIN']);
    }

    /** Manually update KYC status */
    @Patch(':id/kyc')
    updateKyc(@Param('id') id: string, @Body() dto: UpdateKycStatusDto) {
        return this.usersService.updateKycStatus(id, dto, 'admin', ['ADMIN']);
    }
}
