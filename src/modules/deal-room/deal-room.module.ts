import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DealRoomController } from './deal-room.controller';
import { DealRoomService } from './deal-room.service';
import {
  DealDocument,
  DealDocumentSchema,
  Folder,
  FolderSchema,
  AccessLog,
  AccessLogSchema,
} from './deal-room.schema';
import { DealRoomRepository } from './deal-room.repository';
import { DealRoomStorageService } from './deal-room.storage';
import { DealRoomPolicy } from './deal-room.policy';
import { RolesGuard } from '../../common/guards/roles.guard';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DealDocument.name, schema: DealDocumentSchema },
      { name: Folder.name, schema: FolderSchema },
      { name: AccessLog.name, schema: AccessLogSchema },
    ]),
  ],
  controllers: [DealRoomController],
  providers: [
    DealRoomService,
    DealRoomRepository,
    DealRoomStorageService,
    DealRoomPolicy,
    RolesGuard,
  ],
  exports: [DealRoomService],
})
export class DealRoomModule {}
