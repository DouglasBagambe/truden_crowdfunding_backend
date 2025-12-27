import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '../../../common/swagger.decorators';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { UserRole } from '../../../common/enums/role.enum';
import { StatisticsService } from '../statistics.service';

@ApiTags('Statistics')
@Controller('stats/user')
export class UserStatisticsController {
  constructor(private readonly statisticsService: StatisticsService) {}

  @Roles(UserRole.INVESTOR, UserRole.INNOVATOR, UserRole.ADMIN)
  @Get('overview')
  getOverview(@CurrentUser('sub') userId: string): Promise<unknown> {
    return this.statisticsService.getUserOverview(userId);
  }
}
