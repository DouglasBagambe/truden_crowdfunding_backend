import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ROLE_PERMISSIONS } from '../../common/constants/role-permissions';
import { ROLE_DESCRIPTIONS } from '../../common/constants/role-descriptions';
import { Permission } from '../../common/enums/permission.enum';
import { UserRole } from '../../common/enums/role.enum';
import { getPermissionsForRoles as getDefaultPermissions } from '../../common/utils/permissions.util';
import { Role, RoleDocument } from './schemas/role.schema';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class RolesService implements OnModuleInit {
  private readonly logger = new Logger(RolesService.name);

  constructor(
    @InjectModel(Role.name)
    private readonly roleModel: Model<RoleDocument>,
  ) {}

  async onModuleInit() {
    await this.ensureDefaultRoles();
  }

  async ensureDefaultRoles() {
    const entries = Object.entries(ROLE_PERMISSIONS) as Array<
      [UserRole, Permission[]]
    >;
    await this.upsertRoles(
      entries.map(([role, permissions]) => ({
        name: role,
        permissions,
        isSystem: true,
        isActive: true,
        description: ROLE_DESCRIPTIONS[role] || '',
      })),
    );
    this.logger.log(`Ensured ${entries.length} system roles in database`);
  }

  async syncFromConfig(configPath = path.resolve('config/roles.json')) {
    if (!fs.existsSync(configPath)) {
      this.logger.warn(
        `Roles config not found at ${configPath}, skipping sync`,
      );
      return;
    }

    const fileContent = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(fileContent) as Array<{
      name: UserRole;
      permissions: Permission[];
      description?: string;
      isSystem?: boolean;
    }>;

    await this.upsertRoles(
      parsed.map((role) => ({
        ...role,
        isSystem: role.isSystem ?? false,
        isActive: true,
      })),
    );

    this.logger.log(`Synced ${parsed.length} roles from config`);
  }

  private async upsertRoles(
    roles: Array<{
      name: UserRole;
      permissions: Permission[];
      description?: string;
      isSystem?: boolean;
      isActive?: boolean;
    }>,
  ) {
    for (const role of roles) {
      await this.roleModel.updateOne(
        { name: role.name },
        { $set: role },
        { upsert: true },
      );
    }
  }

  async getPermissionsForRoles(
    roles: UserRole[] | undefined,
  ): Promise<Permission[]> {
    const normalizedRoles = Array.isArray(roles) ? roles : [];
    if (normalizedRoles.length === 0) {
      return [];
    }

    const roleDocs = await this.roleModel
      .find({ name: { $in: normalizedRoles }, isActive: true })
      .lean()
      .exec();

    const permSet = new Set<Permission>();
    for (const doc of roleDocs) {
      (doc.permissions || []).forEach((perm) => permSet.add(perm));
    }

    // Fallback to default mapping for any roles missing in DB
    if (permSet.size === 0 || roleDocs.length < normalizedRoles.length) {
      getDefaultPermissions(normalizedRoles).forEach((perm) =>
        permSet.add(perm),
      );
    }

    return Array.from(permSet);
  }
}
