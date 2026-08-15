import { createHash } from 'node:crypto';

import { z } from 'zod';

import type { AuthorizationScope } from './types';

const AUTHORIZATION_SCOPES = [
  'card.basic',
  'card.handle',
  'card.id',
  'offline_access',
  'agent.runtime',
  'agent.enroll',
] as const;
const authorizationScopeSet = new Set<string>(AUTHORIZATION_SCOPES);
const pkceVerifierSchema = z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/);

export function normalizeAuthorizationScopes(rawScopes: string): AuthorizationScope[] {
  const requested = rawScopes.trim().split(/\s+/).filter(Boolean);
  if (requested.length === 0) throw new Error('At least one scope is required');
  if (requested.some((scope) => !authorizationScopeSet.has(scope))) {
    throw new Error('Requested scope is not supported');
  }

  const unique = new Set(requested as AuthorizationScope[]);
  return AUTHORIZATION_SCOPES.filter((scope) => unique.has(scope));
}

export function createS256CodeChallenge(verifier: string): string {
  const parsed = pkceVerifierSchema.safeParse(verifier);
  if (!parsed.success) throw new Error('PKCE verifier is invalid');
  return createHash('sha256').update(parsed.data, 'ascii').digest('base64url');
}
