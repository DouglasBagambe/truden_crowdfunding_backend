import { ConfigService } from '@nestjs/config';

function parseAllowedIds(rawValue?: string): string[] {
  return String(rawValue ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

export function getAllowedRoiUserIds(configService?: ConfigService): string[] {
  const configured =
    configService?.get<string>('NEXT_PUBLIC_ROI_ALLOWED_USER_IDS') ??
    configService?.get<string>('ROI_ALLOWED_USER_IDS') ??
    process.env.ROI_ALLOWED_USER_IDS ??
    process.env.NEXT_PUBLIC_ROI_ALLOWED_USER_IDS;

  return parseAllowedIds(configured);
}

export function hasBackendRoiAccess(
  userId?: string | null,
  configService?: ConfigService,
): boolean {
  if (!userId) {
    return false;
  }

  return getAllowedRoiUserIds(configService).includes(String(userId));
}
