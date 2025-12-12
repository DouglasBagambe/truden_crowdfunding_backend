import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '../../../common/swagger.decorators';
import { Public } from '../../../common/decorators/public.decorator';
import { StatisticsService } from '../statistics.service';

@ApiTags('Statistics')
@Controller('stats/public')
export class PublicStatisticsController {
  constructor(private readonly statisticsService: StatisticsService) {}

  @Public()
  @Get('overview')
  getOverview(): Promise<unknown> {
    return this.statisticsService.getPublicOverview();
  }
}
