import type { PlatformScope } from '@/domain/identity/types';

export type AuthorizationScope = Extract<
  PlatformScope,
  'card.basic' | 'card.handle' | 'card.id' | 'offline_access' | 'agent.runtime' | 'agent.enroll'
>;

export type AuthorizationClient = {
  clientId: string;
  displayName: string;
  audience: string;
  redirectUri: string;
  scopes: AuthorizationScope[];
};

export type ValidatedAuthorizationRequest = {
  client: AuthorizationClient;
  redirectUri: string;
  scopes: AuthorizationScope[];
  state: string;
  codeChallenge: string;
  principalType: 'human' | 'ai';
};

export type PlatformTokenResponse = {
  accessToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  scope: string;
  subject: string;
  audience: string;
  refreshToken?: string;
  refreshExpiresIn?: number;
};

export type PlatformGrantView = {
  grantId: string;
  clientId: string;
  clientDisplayName: string;
  audience: string;
  scopes: AuthorizationScope[];
  status: 'active' | 'revoked';
  createdAt: Date;
  updatedAt: Date;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
};

export type ManageablePlatformGrantView = PlatformGrantView & {
  subject: {
    principalType: 'human' | 'ai';
    cardId: string;
    displayName: string;
    handle: string;
  };
};
