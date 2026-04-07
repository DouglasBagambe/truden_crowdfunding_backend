import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppEmailService } from './services/app-email.service';

@Module({
  imports: [ConfigModule],
  providers: [AppEmailService],
  exports: [AppEmailService],
})
export class CommonModule {}
