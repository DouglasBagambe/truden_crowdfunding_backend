import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  Request,
  BadRequestException,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import type { NotificationCategory } from './schemas/notification.schema';

const categories = new Set<NotificationCategory>([
  'campaign',
  'financial',
  'system',
  'security',
]);

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(
    @Query('category') category: string | undefined,
    @Request() request: { user: { sub?: string; userId?: string } },
  ) {
    const userId = request.user?.sub ?? request.user?.userId;
    if (!userId)
      throw new BadRequestException('Authenticated user is required');
    if (category && !categories.has(category as NotificationCategory))
      throw new BadRequestException('Invalid notification category');
    return this.notifications.list(
      userId,
      category as NotificationCategory | undefined,
    );
  }

  @Post(':id/read')
  markRead(
    @Param('id') id: string,
    @Request() request: { user: { sub?: string; userId?: string } },
  ) {
    const userId = request.user?.sub ?? request.user?.userId;
    if (!userId)
      throw new BadRequestException('Authenticated user is required');
    return this.notifications.markRead(userId, id);
  }

  @Post('read-all')
  markAllRead(@Request() request: { user: { sub?: string; userId?: string } }) {
    const userId = request.user?.sub ?? request.user?.userId;
    if (!userId)
      throw new BadRequestException('Authenticated user is required');
    return this.notifications.markAllRead(userId);
  }
}
