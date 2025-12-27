import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '../../../common/swagger.decorators';
import { Roles } from '../../../common/decorators/roles.decorator';
import { UserRole } from '../../../common/enums/role.enum';
import { StatisticsService } from '../statistics.service';
import { TrendsQueryDto } from '../dto/trends-query.dto';

@ApiTags('Statistics')
@Controller('stats/admin')
export class AdminStatisticsController {
  constructor(private readonly statisticsService: StatisticsService) {}

  @Roles(UserRole.ADMIN, UserRole.SUPERADMIN, UserRole.APPROVER)
  @Get('overview')
  getOverview(): Promise<unknown> {
    return this.statisticsService.getAdminOverview();
  }

  @Roles(UserRole.ADMIN, UserRole.SUPERADMIN, UserRole.APPROVER)
  @Get('trends')
  getTrends(@Query() query: TrendsQueryDto): Promise<unknown> {
    return this.statisticsService.getAdminTrends(query);
  }
}
