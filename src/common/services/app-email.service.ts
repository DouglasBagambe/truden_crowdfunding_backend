import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sgMail from '@sendgrid/mail';

export interface SendAppEmailInput {
  to: string;
  subject: string;
  text: string;
  html: string;
}

@Injectable()
export class AppEmailService {
  private readonly logger = new Logger(AppEmailService.name);

  constructor(private readonly configService: ConfigService) {}

  async send(input: SendAppEmailInput): Promise<boolean> {
    const apiKey = this.configService.get<string>('SENDGRID_API_KEY');
    const from = this.configService.get<string>('EMAIL_FROM');

    if (!apiKey || !from || !input.to) {
      this.logger.warn(
        `Skipping email "${input.subject}": SENDGRID_API_KEY, EMAIL_FROM, or recipient is missing`,
      );
      return false;
    }

    sgMail.setApiKey(apiKey);
    const residency = this.configService.get<string>('SENDGRID_RESIDENCY');
    if (residency) {
      const sgWithResidency = sgMail as unknown as {
        setDataResidency?: (region: string) => void;
      };
      if (typeof sgWithResidency.setDataResidency === 'function') {
        sgWithResidency.setDataResidency(residency);
      }
    }

    try {
      await sgMail.send({
        to: input.to,
        from,
        subject: input.subject,
        text: input.text,
        html: input.html,
      });
      return true;
    } catch (error: any) {
      const message =
        error?.response?.body?.errors?.[0]?.message ||
        error?.message ||
        'Unknown SendGrid error';
      this.logger.warn(`Failed to send "${input.subject}" to ${input.to}: ${message}`);
      return false;
    }
  }
}
