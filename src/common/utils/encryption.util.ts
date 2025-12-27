import crypto from 'crypto';

export interface EncryptedPayload {
  iv: string;
  authTag: string;
  ciphertext: string;
}

const ALGO = 'aes-256-gcm';

export function getEncryptionKey(): Buffer {
  const keyB64 = process.env.KYC_ENCRYPTION_KEY;
  if (!keyB64) {
    throw new Error('KYC_ENCRYPTION_KEY is not configured');
  }
  const key = Buffer.from(keyB64, 'base64');
  if (key.length !== 32) {
    throw new Error('KYC_ENCRYPTION_KEY must be 32 bytes (base64-encoded)');
  }
  return key;
}

export function encryptObject(value: unknown, key: Buffer): EncryptedPayload {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const json = JSON.stringify(value ?? {});
  const ciphertext = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

export function decryptObject<T = unknown>(
  payload: EncryptedPayload | string | undefined,
  key: Buffer,
): T | undefined {
  if (!payload) return undefined;
  const data =
    typeof payload === 'string'
      ? (JSON.parse(payload) as EncryptedPayload)
      : payload;
  const iv = Buffer.from(data.iv, 'base64');
  const authTag = Buffer.from(data.authTag, 'base64');
  const ciphertext = Buffer.from(data.ciphertext, 'base64');
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(
    'utf8',
  );
  return JSON.parse(plaintext) as T;
}
