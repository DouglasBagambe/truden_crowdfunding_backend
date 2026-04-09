import { ConfigService } from '@nestjs/config';

function parseAllowedIds(rawValue?: string): string[] {
  return String(rawValue ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

function normalize(value?: string | null): string {
  return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

export function isPublicRoiAccessMode(configService?: ConfigService): boolean {
  const mode =
    configService?.get<string>('ROI_ACCESS_MODE') ??
    configService?.get<string>('NEXT_PUBLIC_ROI_ACCESS_MODE') ??
    process.env.ROI_ACCESS_MODE ??
    process.env.NEXT_PUBLIC_ROI_ACCESS_MODE;

  return normalize(mode) === 'PUBLIC';
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
  const allowedIds = getAllowedRoiUserIds(configService);
  if (isPublicRoiAccessMode(configService) || allowedIds.includes('*')) {
    return true;
  }

  if (!userId) {
    return false;
  }

  return allowedIds.includes(String(userId));
}
