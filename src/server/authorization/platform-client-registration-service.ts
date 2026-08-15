import { z } from 'zod';

import type { AuthorizationScope } from '@/domain/authorization/types';
import type { PostgresPlatformClientRepository } from '@/server/postgres/platform-client-repository';

const supportedScopes = [
  'card.basic',
  'card.handle',
  'card.id',
  'offline_access',
  'agent.runtime',
  'agent.enroll',
] as const satisfies readonly AuthorizationScope[];

const registrationSchema = z.object({
  clientId: z.string().regex(/^[a-z][a-z0-9_-]{2,63}$/),
  displayName: z.string().trim().min(1).max(64),
  audience: z.string().regex(/^[a-z][a-z0-9:_-]{2,127}$/),
  redirectUris: z.array(z.url().max(2048)).min(1).max(10),
  scopes: z.array(z.enum(supportedScopes)).min(1).max(supportedScopes.length),
});

export type PlatformClientRegistration = {
  clientId: string;
  displayName: string;
  audience: string;
  redirectUris: readonly string[];
  scopes: readonly AuthorizationScope[];
};

export class PlatformClientRegistrationConflictError extends Error {
  constructor() {
    super('The platform client already exists with different immutable configuration');
    this.name = 'PlatformClientRegistrationConflictError';
  }
}

function isAllowedRedirect(value: string, allowInsecureLocalhost: boolean): boolean {
  const url = new URL(value);
  if (url.protocol === 'https:') return true;
  return allowInsecureLocalhost
    && url.protocol === 'http:'
    && url.hostname === 'localhost';
}

export class PlatformClientRegistrationService {
  constructor(private readonly repository: PostgresPlatformClientRepository) {}

  async register(
    rawInput: PlatformClientRegistration,
    options: { allowInsecureLocalhost?: boolean } = {},
  ) {
    const input = registrationSchema.parse(rawInput);
    const redirectUris = [...new Set(input.redirectUris)].sort();
    const scopes = [...new Set(input.scopes)].sort() as AuthorizationScope[];
    if (redirectUris.some((uri) => !isAllowedRedirect(uri, options.allowInsecureLocalhost === true))) {
      throw new Error('Platform callback URLs must use HTTPS');
    }
    return this.repository.register({ ...input, redirectUris, scopes });
  }
}
