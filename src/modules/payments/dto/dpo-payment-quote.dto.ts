import { PickType } from '@nestjs/swagger';
import { InitializeDPOPaymentDto } from './initialize-dpo-payment.dto';

export class DpoPaymentQuoteDto extends PickType(InitializeDPOPaymentDto, [
  'projectId',
  'amount',
  'currency',
] as const) {}
