import { randomBytes, scrypt as nodeScrypt, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

const SALT_BYTES = 16;
const HASH_BYTES = 64;
const SCRYPT_OPTIONS = { N: 32_768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;

export const passwordSchema = z.string()
  .min(12, 'password must contain at least 12 characters')
  .max(128, 'password must contain at most 128 characters')
  .refine((password) => password === password.trim(), 'password cannot start or end with spaces');

export type PasswordCredential = {
  hash: Buffer;
  salt: Buffer;
  algorithm: 'scrypt-v1';
};

function derivePassword(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    nodeScrypt(password, salt, HASH_BYTES, SCRYPT_OPTIONS, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

export async function hashPassword(password: string): Promise<PasswordCredential> {
  const parsed = passwordSchema.parse(password);
  const salt = randomBytes(SALT_BYTES);
  return { hash: await derivePassword(parsed, salt), salt, algorithm: 'scrypt-v1' };
}

export async function verifyPassword(
  password: string,
  credential: PasswordCredential,
): Promise<boolean> {
  if (credential.algorithm !== 'scrypt-v1'
    || credential.hash.length !== HASH_BYTES
    || credential.salt.length !== SALT_BYTES) return false;
  const candidate = await derivePassword(password, credential.salt);
  return timingSafeEqual(candidate, credential.hash);
}
