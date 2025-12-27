import { IsString } from 'class-validator';

// Smile ID sends most fields as strings; keep parsing inside the service.
export class SmileWebhookDto {
  @IsString()
  job_id!: string;

  @IsString()
  partner_params!: string; // JSON string containing user_id/job_id

  @IsString()
  result!: string; // JSON string with verification result

  @IsString()
  timestamp!: string;

  @IsString()
  signature!: string;

  @IsString()
  report_type!: string;

  @IsString()
  result_id!: string;
}
