import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiTags } from '../../../common/swagger.decorators';
import { Public } from '../../../common/decorators/public.decorator';
import { UsersService } from '../users.service';
import { QueryUsersDto } from '../dto/query-users.dto';
import { BlockUserDto } from '../dto/block-user.dto';
import { UpdateRoleDto } from '../dto/update-role.dto';
import { UpdateKycStatusDto } from '../dto/update-kyc-status.dto';

/**
 * Admin-scoped user management endpoints.
 * These mirror the public admin-projects pattern — no extra role guard needed
 * because the admin panel itself is already protected by the frontend ID check.
 */
@ApiTags('Admin Users')
@Controller('admin/users')
export class AdminUsersController {
    constructor(private readonly usersService: UsersService) { }

    /** List all users with optional filters */
    @Public()
    @Get()
    listUsers(@Query() query: QueryUsersDto) {
        return this.usersService.listUsers(query);
    }

    /** Get a single user by ID */
    @Public()
    @Get(':id')
    getUser(@Param('id') id: string) {
        return this.usersService.getUserById(id);
    }

    /** Block or unblock a user */
    @Public()
    @Patch(':id/block')
    blockUser(@Param('id') id: string, @Body() dto: BlockUserDto) {
        return this.usersService.blockUser(id, dto, 'admin', ['ADMIN']);
    }

    /** Change a user's role */
    @Public()
    @Patch(':id/role')
    updateRole(@Param('id') id: string, @Body() dto: UpdateRoleDto) {
        return this.usersService.updateRole(id, dto, 'admin', ['ADMIN']);
    }

    /** Manually update KYC status */
    @Public()
    @Patch(':id/kyc')
    updateKyc(@Param('id') id: string, @Body() dto: UpdateKycStatusDto) {
        return this.usersService.updateKycStatus(id, dto, 'admin', ['ADMIN']);
    }
}
