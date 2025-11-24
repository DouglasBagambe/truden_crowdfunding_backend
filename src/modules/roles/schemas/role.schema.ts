import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { Permission } from '../../../common/enums/permission.enum';
import { UserRole } from '../../../common/enums/role.enum';

@Schema({ collection: 'roles', timestamps: true })
export class Role {
  @Prop({
    required: true,
    unique: true,
    uppercase: true,
    trim: true,
    type: String,
    enum: UserRole,
  })
  name!: UserRole;

  @Prop({
    type: [String],
    enum: Object.values(Permission),
    default: [],
  })
  permissions!: Permission[];

  @Prop({ default: '' })
  description?: string;

  @Prop({ default: false })
  isSystem!: boolean;

  @Prop({ default: true })
  isActive!: boolean;
}

export type RoleDocument = HydratedDocument<Role>;

export const RoleSchema = SchemaFactory.createForClass(Role);
