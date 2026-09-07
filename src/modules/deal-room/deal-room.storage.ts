import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { randomBytes } from 'crypto';

@Injectable()
export class DealRoomStorageService {
  generateStorageKey(projectId: string, filename: string): string {
    const id = randomBytes(8).toString('hex');
    return `dealroom/${projectId}/${id}-${filename}`;
  }

  uploadPlaceholder(storageKey: string): Promise<{
    storageKey: string;
    location: string;
  }> {
    void storageKey;
    return Promise.reject(
      new ServiceUnavailableException(
        'Deal-room durable storage is not configured',
      ),
    );
  }

  getPresignedUrl(
    storageKey: string,
    expiresInSeconds: number,
  ): Promise<{ url: string; expiresIn: number }> {
    void storageKey;
    void expiresInSeconds;
    return Promise.reject(
      new ServiceUnavailableException(
        'Deal-room signed download storage is not configured',
      ),
    );
  }
}
