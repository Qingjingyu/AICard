export type PrincipalType = 'human' | 'ai';
export type CardStatus = 'active' | 'suspended' | 'retired';

export type IdentityRecord = {
  principalId: string;
  principalType: PrincipalType;
  cardId: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  status: CardStatus;
  createdAt: Date;
  updatedAt: Date;
};

export type ControllerSummary = {
  cardId: string;
  displayName: string;
  handle: string;
  verifiedAt: Date;
};

export type HandleHistoryEntry = {
  handle: string;
  retiredAt: Date;
};

export type PlatformScope =
  | 'card.basic'
  | 'card.handle'
  | 'card.id'
  | 'agent.profile'
  | 'agent.presence'
  | 'offline_access'
  | 'agent.runtime'
  | 'agent.enroll';
