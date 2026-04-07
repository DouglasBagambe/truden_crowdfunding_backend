import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { Public } from '../../../common/decorators/public.decorator';
import { SmileWebhookDto } from '../dto/smile-webhook.dto';

@Controller('webhooks/kyc')
export class KycWebhookController {
  @Public()
  @Post('smile')
  handleSmileWebhook(@Body() dto: SmileWebhookDto) {
    void dto;
    throw new BadRequestException(
      'Legacy Smile webhook is disabled. Use the Didit-backed /kyc/webhook/didit flow.',
    );
  }
}
