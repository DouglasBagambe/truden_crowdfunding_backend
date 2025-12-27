import { Body, Controller, Post } from '@nestjs/common';
import { Public } from '../../../common/decorators/public.decorator';
import { UsersService } from '../users.service';
import { SmileWebhookDto } from '../dto/smile-webhook.dto';

@Controller('webhooks/kyc')
export class KycWebhookController {
  constructor(private readonly usersService: UsersService) {}

  @Public()
  @Post('smile')
  handleSmileWebhook(@Body() dto: SmileWebhookDto) {
    return this.usersService.handleSmileWebhook(dto);
  }
}
