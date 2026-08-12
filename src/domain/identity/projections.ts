import type {
  ControllerSummary,
  HandleHistoryEntry,
  IdentityRecord,
  PlatformScope,
} from './types';

export function projectPublicCard(identity: IdentityRecord) {
  return {
    card_id: identity.cardId,
    handle: identity.handle,
    display_name: identity.displayName,
    principal_type: identity.principalType,
    avatar_url: identity.avatarUrl,
    bio: identity.bio,
    status: identity.status,
  };
}

export type PublicCardProjection = ReturnType<typeof projectPublicCard>;

export function projectPlatformCard(
  identity: IdentityRecord,
  options: { subject: string; scopes: PlatformScope[] },
) {
  const scopeSet = new Set(options.scopes);
  const projection: Record<string, unknown> = {
    sub: options.subject,
  };

  if (scopeSet.has('card.basic')) {
    projection.display_name = identity.displayName;
    projection.principal_type = identity.principalType;
    projection.avatar_url = identity.avatarUrl;
  }
  if (scopeSet.has('card.handle')) projection.handle = identity.handle;
  if (scopeSet.has('card.id')) projection.card_id = identity.cardId;

  return projection;
}

export function projectPrivateCard(
  identity: IdentityRecord,
  details: { controllers: ControllerSummary[]; handleHistory: HandleHistoryEntry[] },
) {
  return {
    card: projectPublicCard(identity),
    controllers: details.controllers.map((controller) => ({
      card_id: controller.cardId,
      display_name: controller.displayName,
      handle: controller.handle,
      verified_at: controller.verifiedAt.toISOString(),
    })),
    handle_history: details.handleHistory.map((entry) => ({
      handle: entry.handle,
      retired_at: entry.retiredAt.toISOString(),
    })),
    lifecycle: {
      status: identity.status,
      created_at: identity.createdAt.toISOString(),
      updated_at: identity.updatedAt.toISOString(),
    },
  };
}

export type PrivateCardProjection = ReturnType<typeof projectPrivateCard>;
