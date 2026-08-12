import { describe, expect, it, vi } from 'vitest';

import { IdentityNotFoundError } from '@/server/identity-errors';

const validCardId = 'aic_01J4Z7Y8K9M2N3P4Q5R6S7T8VW';

describe('public Card route', () => {
  it('returns the explicit public projection with no-store caching', async () => {
    const { createPublicCardRoute } = await import('@/app/api/v1/cards/[cardId]/route');
    const getPublicCard = vi.fn().mockResolvedValue({
      card_id: validCardId,
      handle: 'yoyoo_assistant',
      display_name: '悠悠',
      principal_type: 'ai',
      avatar_url: null,
      bio: '数字员工',
      status: 'active',
    });
    const GET = createPublicCardRoute({ getPublicCard });

    const response = await GET(new Request(`http://localhost/api/v1/cards/${validCardId}`), {
      params: Promise.resolve({ cardId: validCardId }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(body).toEqual(expect.objectContaining({ card_id: validCardId, display_name: '悠悠' }));
    expect(JSON.stringify(body)).not.toMatch(/principal_id|controller|token|secret/i);
  });

  it('rejects malformed Card IDs before repository lookup', async () => {
    const { createPublicCardRoute } = await import('@/app/api/v1/cards/[cardId]/route');
    const getPublicCard = vi.fn();
    const GET = createPublicCardRoute({ getPublicCard });

    const response = await GET(new Request('http://localhost/api/v1/cards/not-a-card'), {
      params: Promise.resolve({ cardId: 'not-a-card' }),
    });

    expect(response.status).toBe(400);
    expect(getPublicCard).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({ error: { code: 'INVALID_REQUEST' } });
  });

  it('returns a stable not-found error without internal details', async () => {
    const { createPublicCardRoute } = await import('@/app/api/v1/cards/[cardId]/route');
    const GET = createPublicCardRoute({
      getPublicCard: vi.fn().mockRejectedValue(new IdentityNotFoundError()),
    });

    const response = await GET(new Request(`http://localhost/api/v1/cards/${validCardId}`), {
      params: Promise.resolve({ cardId: validCardId }),
    });
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toMatchObject({ error: { code: 'RESOURCE_NOT_FOUND', retryable: false } });
    expect(JSON.stringify(body)).not.toContain('PostgreSQL');
  });
});

describe('private Card route', () => {
  it('denies access until authenticated sessions exist', async () => {
    const { createPrivateCardRoute } = await import('@/app/api/v1/me/card/route');
    const GET = createPrivateCardRoute({
      resolveSession: vi.fn().mockResolvedValue(null),
      getPrivateCard: vi.fn(),
      listCredentials: vi.fn(),
    });

    const response = await GET(new Request('http://localhost/api/v1/me/card'));

    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({
      error: { code: 'AUTHENTICATION_REQUIRED', retryable: false },
    });
  });

  it('returns private Card data without credential secrets for an authenticated session', async () => {
    const { createPrivateCardRoute } = await import('@/app/api/v1/me/card/route');
    const GET = createPrivateCardRoute({
      resolveSession: vi.fn().mockResolvedValue({ principalId: 'principal_test' }),
      getPrivateCard: vi.fn().mockResolvedValue({ card: { display_name: '苏白' } }),
      listCredentials: vi.fn().mockResolvedValue([{
        credentialId: 'credential_test',
        deviceType: 'multiDevice',
        backedUp: true,
        createdAt: new Date('2026-08-08T00:00:00.000Z'),
        lastUsedAt: null,
        revokedAt: null,
        publicKey: new Uint8Array([1, 2, 3]),
      }]),
    });

    const response = await GET(new Request('http://localhost/api/v1/me/card', {
      headers: { cookie: 'aicard_session=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ credentials: [{ credential_id: 'credential_test' }] });
    expect(JSON.stringify(body)).not.toMatch(/public_key|secret|session/i);
  });
});
