import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { JwtPayload } from '../../../common/interfaces/user.interface';
import { DealRoomService } from '../services/deal-room.service';
import { UploadDto } from '../dto/upload.dto';
import { SearchDto } from '../dto/search.dto';
import { GrantAccessDto } from '../dto/grant-access.dto';
import { RevokeAccessDto } from '../dto/revoke-access.dto';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { UserRole } from '../../../common/enums/role.enum';

@Controller('deal-room')
@UseGuards(RolesGuard)
export class DealRoomController {
  constructor(private readonly dealRoomService: DealRoomService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file'))
  @Roles(UserRole.ADMIN, UserRole.INNOVATOR)
  @HttpCode(HttpStatus.CREATED)
  async upload(
    @CurrentUser() user: JwtPayload,
    @UploadedFile()
    file:
      | {
          originalname: string;
          mimetype: string;
          size: number;
        }
      | undefined,
    @Body() dto: UploadDto,
  ) {
    return this.dealRoomService.uploadFile(user, file, dto);
  }

  @Get(':projectId/files')
  @Roles(UserRole.ADMIN, UserRole.INNOVATOR, UserRole.INVESTOR)
  async listProjectFiles(
    @CurrentUser() user: JwtPayload,
    @Param('projectId') projectId: string,
    @Query() query: SearchDto,
  ) {
    return this.dealRoomService.listProjectFiles(user, projectId, query);
  }

  @Get('file/:documentId/preview')
  @Roles(UserRole.ADMIN, UserRole.INNOVATOR, UserRole.INVESTOR)
  async preview(
    @CurrentUser() user: JwtPayload,
    @Param('documentId') documentId: string,
  ) {
    return this.dealRoomService.getPreviewUrl(user, documentId);
  }

  @Get('file/:documentId/download')
  @Roles(UserRole.ADMIN, UserRole.INNOVATOR, UserRole.INVESTOR)
  async download(
    @CurrentUser() user: JwtPayload,
    @Param('documentId') documentId: string,
  ) {
    return this.dealRoomService.getDownloadUrl(user, documentId);
  }

  @Post('file/:documentId/grant')
  @Roles(UserRole.ADMIN, UserRole.INNOVATOR)
  async grantAccess(
    @CurrentUser() user: JwtPayload,
    @Param('documentId') documentId: string,
    @Body() dto: GrantAccessDto,
  ) {
    dto.documentId = documentId;
    return this.dealRoomService.grantAccess(user, dto);
  }

  @Post('file/:documentId/revoke')
  @Roles(UserRole.ADMIN, UserRole.INNOVATOR)
  async revokeAccess(
    @CurrentUser() user: JwtPayload,
    @Param('documentId') documentId: string,
    @Body() dto: RevokeAccessDto,
  ) {
    dto.documentId = documentId;
    return this.dealRoomService.revokeAccess(user, dto);
  }

  @Delete('file/:documentId')
  @Roles(UserRole.ADMIN, UserRole.INNOVATOR)
  @HttpCode(HttpStatus.OK)
  async deleteDocument(
    @CurrentUser() user: JwtPayload,
    @Param('documentId') documentId: string,
  ) {
    return this.dealRoomService.deleteDocument(user, documentId);
  }

  @Get('audit/:projectId')
  @Roles(UserRole.ADMIN)
  async audit(
    @CurrentUser() user: JwtPayload,
    @Param('projectId') projectId: string,
  ) {
    return this.dealRoomService.getAuditLogs(user, projectId);
  }
}
