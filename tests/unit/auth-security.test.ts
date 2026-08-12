import { describe, expect, it } from 'vitest';

import {
  createOpaqueToken,
  hashOpaqueToken,
  tokensMatch,
} from '@/server/authentication/auth-security';

describe('authentication security primitives', () => {
  it('generates 256-bit URL-safe tokens and only persists deterministic hashes', () => {
    const token = createOpaqueToken();
    const second = createOpaqueToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(second).not.toBe(token);
    expect(hashOpaqueToken(token)).toHaveLength(32);
    expect(hashOpaqueToken(token)).toEqual(hashOpaqueToken(token));
    expect(Buffer.from(hashOpaqueToken(token)).toString('utf8')).not.toContain(token);
  });

  it('compares CSRF and session tokens without accepting malformed values', () => {
    const token = createOpaqueToken();

    expect(tokensMatch(token, token)).toBe(true);
    expect(tokensMatch(token, createOpaqueToken())).toBe(false);
    expect(tokensMatch(token, '')).toBe(false);
    expect(tokensMatch(token, 'not-base64url')).toBe(false);
  });
});
