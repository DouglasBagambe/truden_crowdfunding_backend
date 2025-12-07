import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';

@Injectable()
export class DealRoomStorageService {
  generateStorageKey(projectId: string, filename: string): string {
    const id = randomBytes(8).toString('hex');
    return `dealroom/${projectId}/${id}-${filename}`;
  }

  async uploadPlaceholder(storageKey: string): Promise<{
    storageKey: string;
    location: string;
  }> {
    await Promise.resolve();
    return {
      storageKey,
      location: `placeholder://${storageKey}`,
    };
  }

  async getPresignedUrl(
    storageKey: string,
    expiresInSeconds: number,
  ): Promise<{ url: string; expiresIn: number }> {
    await Promise.resolve();
    const base =
      process.env.DEALROOM_PUBLIC_BASE_URL || 'https://dealroom.local';
    const url = `${base}/${encodeURIComponent(storageKey)}?expiresIn=${expiresInSeconds}`;
    return { url, expiresIn: expiresInSeconds };
  }
}
