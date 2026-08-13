import { describe, expect, it } from 'vitest';

import {
  projectPlatformCard,
  projectPrivateCard,
  projectPublicCard,
} from '@/domain/identity/projections';
import type { IdentityRecord } from '@/domain/identity/types';

const identity: IdentityRecord = {
  principalId: '018f4f5d-8f6a-7a13-8e2c-1f21f3489a10',
  principalType: 'ai',
  cardId: 'AI_100001',
  handle: 'yoyoo_assistant',
  displayName: '悠悠',
  avatarUrl: null,
  bio: '数字员工',
  status: 'active',
  createdAt: new Date('2026-08-08T00:00:00.000Z'),
  updatedAt: new Date('2026-08-08T00:00:00.000Z'),
};

describe('AI Card visibility projections', () => {
  it('returns only the public front allowlist', () => {
    expect(projectPublicCard(identity)).toEqual({
      card_id: identity.cardId,
      handle: identity.handle,
      display_name: identity.displayName,
      principal_type: identity.principalType,
      avatar_url: null,
      bio: identity.bio,
      status: identity.status,
    });
    expect(JSON.stringify(projectPublicCard(identity))).not.toContain('principalId');
  });

  it('returns only scope-covered platform claims and excludes global Card ID by default', () => {
    const projection = projectPlatformCard(identity, {
      subject: 'sub_yJm8J0RkC5z2QnYtF9pS7uVx3aB6dE1gH4iK8mN2qWc',
      scopes: ['card.basic', 'card.handle'],
    });

    expect(projection).toEqual({
      sub: 'sub_yJm8J0RkC5z2QnYtF9pS7uVx3aB6dE1gH4iK8mN2qWc',
      display_name: '悠悠',
      principal_type: 'ai',
      avatar_url: null,
      handle: 'yoyoo_assistant',
    });
    expect(projection).not.toHaveProperty('card_id');
  });

  it('does not expose basic claims when card.basic was not granted', () => {
    expect(projectPlatformCard(identity, {
      subject: 'sub_yJm8J0RkC5z2QnYtF9pS7uVx3aB6dE1gH4iK8mN2qWc',
      scopes: ['card.handle'],
    })).toEqual({
      sub: 'sub_yJm8J0RkC5z2QnYtF9pS7uVx3aB6dE1gH4iK8mN2qWc',
      handle: 'yoyoo_assistant',
    });
  });

  it('keeps the private back free of internal principal IDs and secrets', () => {
    const projection = projectPrivateCard(identity, {
      controllers: [{
        cardId: 'AI_100002',
        displayName: '苏白',
        handle: 'subai_user',
        verifiedAt: new Date('2026-08-08T00:00:00.000Z'),
      }],
      handleHistory: [{ handle: 'yoyoo_old', retiredAt: new Date('2026-08-08T00:00:00.000Z') }],
    });
    const serialized = JSON.stringify(projection);

    expect(projection.card.card_id).toBe(identity.cardId);
    expect(projection.controllers[0]?.handle).toBe('subai_user');
    expect(serialized).not.toContain('principalId');
    expect(serialized).not.toMatch(/token|secret|private_key/i);
  });
});
