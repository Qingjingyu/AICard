import { createHash, randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  createS256CodeChallenge,
  normalizeAuthorizationScopes,
} from '@/domain/authorization/scopes';

describe('platform authorization primitives', () => {
  it('normalizes, de-duplicates, and orders the platform scope allowlist', () => {
    expect(normalizeAuthorizationScopes(
      'agent.runtime offline_access card.handle card.basic card.handle',
    )).toEqual([
      'card.basic',
      'card.handle',
      'offline_access',
      'agent.runtime',
    ]);
  });

  it('rejects unknown and empty scopes', () => {
    expect(() => normalizeAuthorizationScopes('')).toThrow('At least one scope is required');
    expect(() => normalizeAuthorizationScopes('card.basic messages.write')).toThrow(
      'Requested scope is not supported',
    );
  });

  it('derives the RFC 7636 S256 challenge from a valid verifier', () => {
    const verifier = randomBytes(32).toString('base64url');
    const expected = createHash('sha256').update(verifier, 'ascii').digest('base64url');

    expect(createS256CodeChallenge(verifier)).toBe(expected);
    expect(() => createS256CodeChallenge('too-short')).toThrow('PKCE verifier is invalid');
  });
});
