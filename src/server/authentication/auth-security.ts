import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const opaqueTokenPattern = /^[A-Za-z0-9_-]{43}$/;

export function createOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashOpaqueToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

export function tokensMatch(expected: string | undefined, received: string | undefined): boolean {
  if (!expected || !received) return false;
  if (!opaqueTokenPattern.test(expected) || !opaqueTokenPattern.test(received)) return false;
  return timingSafeEqual(Buffer.from(expected, 'ascii'), Buffer.from(received, 'ascii'));
}
