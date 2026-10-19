import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class FlutterwaveV4AuthService {
  private token?: { value: string; expiresAt: number };
  private pending?: Promise<string>;
  constructor(
    private readonly config: ConfigService,
    private readonly http: HttpService,
  ) {}

  async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000)
      return this.token.value;
    if (this.pending) return this.pending;
    this.pending = this.refresh();
    try {
      return await this.pending;
    } finally {
      this.pending = undefined;
    }
  }

  private async refresh(): Promise<string> {
    const clientId = this.config
      .get<string>('FLUTTERWAVE_V4_CLIENT_ID')
      ?.trim();
    const clientSecret = this.config
      .get<string>('FLUTTERWAVE_V4_CLIENT_SECRET')
      ?.trim();
    if (!clientId || !clientSecret)
      throw new ServiceUnavailableException(
        'Flutterwave v4 payout OAuth client credentials are not configured',
      );
    try {
      const response = await firstValueFrom(
        this.http.post<{ access_token?: unknown; expires_in?: unknown }>(
          'https://idp.flutterwave.com/realms/flutterwave/protocol/openid-connect/token',
          new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: 'client_credentials',
          }).toString(),
          {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 15_000,
          },
        ),
      );
      const value = response.data.access_token;
      const expires = Number(response.data.expires_in);
      if (
        typeof value !== 'string' ||
        !value.trim() ||
        !Number.isFinite(expires) ||
        expires <= 60
      )
        throw new Error('Invalid OAuth token response');
      this.token = { value, expiresAt: Date.now() + expires * 1000 };
      return value;
    } catch {
      // Provider error objects may contain credentials in their request config.
      throw new ServiceUnavailableException(
        'Flutterwave v4 payout authentication failed. Check the configured sandbox OAuth client.',
      );
    }
  }
}
