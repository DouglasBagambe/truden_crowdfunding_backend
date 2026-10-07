import { Controller, Delete, Get, Param, Put } from '@nestjs/common';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { SavedProjectsService } from '../services/saved-projects.service';
@Controller('projects/:id/saved')
export class SavedProjectsController {
  constructor(private readonly saved: SavedProjectsService) {}
  @Get() get(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.saved.get(userId, id);
  }
  @Put() save(@CurrentUser('sub') userId: string, @Param('id') id: string) {
    return this.saved.set(userId, id, true);
  }
  @Delete() remove(
    @CurrentUser('sub') userId: string,
    @Param('id') id: string,
  ) {
    return this.saved.set(userId, id, false);
  }
}
