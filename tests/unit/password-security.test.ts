import { describe, expect, it } from 'vitest';

import {
  hashPassword,
  passwordSchema,
  verifyPassword,
} from '@/server/authentication/password-security';

describe('password security', () => {
  it('accepts a strong passphrase and rejects ambiguous boundary input', () => {
    expect(passwordSchema.safeParse('correct horse 电池 staple').success).toBe(true);
    expect(passwordSchema.safeParse('12345678').success).toBe(true);
    expect(passwordSchema.safeParse('1234567').success).toBe(false);
    expect(passwordSchema.safeParse(` ${'a'.repeat(8)}`).success).toBe(false);
    expect(passwordSchema.safeParse('a'.repeat(129)).success).toBe(false);
  });

  it('uses a random salt and verifies without exposing the password', async () => {
    const first = await hashPassword('correct horse 电池 staple');
    const second = await hashPassword('correct horse 电池 staple');

    expect(first.algorithm).toBe('scrypt-v1');
    expect(first.salt).not.toEqual(second.salt);
    expect(first.hash).not.toEqual(second.hash);
    await expect(verifyPassword('correct horse 电池 staple', first)).resolves.toBe(true);
    await expect(verifyPassword('wrong password value', first)).resolves.toBe(false);
    expect(first.hash.toString('utf8')).not.toContain('correct horse');
  });
});
