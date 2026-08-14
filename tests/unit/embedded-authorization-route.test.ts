import { describe, expect, it, vi } from 'vitest';

const config = {
  appOrigin: 'http://localhost:3000',
  trustedProductOrigins: ['http://localhost:4173'],
};

const authorizationRequest = {
  responseType: 'code',
  clientId: 'yoyoo_dev',
  redirectUri: 'http://localhost:4173/auth/aicard/callback',
  scope: 'card.basic card.handle card.id offline_access',
  state: 'state_1234567890123456',
  codeChallenge: 'x'.repeat(43),
  codeChallengeMethod: 'S256',
  principalType: 'human',
};

function request(origin: string) {
  const csrf = 'c'.repeat(43);
  return new Request('http://localhost:3000/api/v1/authorize', {
    method: 'POST',
    headers: {
      origin,
      cookie: `aicard_session=${'s'.repeat(43)}; aicard_csrf=${csrf}`,
      'content-type': 'application/json',
      'x-csrf-token': csrf,
    },
    body: JSON.stringify({ decision: 'approve', request: authorizationRequest }),
  });
}

describe('embedded product authorization route', () => {
  it('authorizes from an exact trusted product origin with credentialed CORS', async () => {
    const { createPlatformAuthorizationRoute } = await import('@/app/api/v1/authorize/route');
    const resolveConsent = vi.fn().mockResolvedValue({
      redirectUrl: `${authorizationRequest.redirectUri}?state=${authorizationRequest.state}&code=ac_${'a'.repeat(43)}`,
    });
    const route = createPlatformAuthorizationRoute({
      config,
      resolveSession: vi.fn().mockResolvedValue({
        principalId: '018f4f5d-8f6a-7a13-8e2c-1f21f3489a40',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
        verifiedAt: new Date(),
      }),
      consumeRateLimit: vi.fn().mockResolvedValue({
        allowed: true,
        remaining: 19,
        retryAfterSeconds: 0,
      }),
      resolveConsent,
      listControlledCards: vi.fn(),
    });

    const response = await route(request('http://localhost:4173'));

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:4173');
    expect(response.headers.get('access-control-allow-credentials')).toBe('true');
    expect(resolveConsent).toHaveBeenCalledOnce();
    expect(await response.json()).toEqual({
      redirect_url: expect.stringContaining('/auth/aicard/callback?'),
    });
  });

  it('rejects an untrusted origin before reading the session', async () => {
    const { createPlatformAuthorizationRoute } = await import('@/app/api/v1/authorize/route');
    const resolveSession = vi.fn();
    const route = createPlatformAuthorizationRoute({
      config,
      resolveSession,
      consumeRateLimit: vi.fn(),
      resolveConsent: vi.fn(),
      listControlledCards: vi.fn(),
    });

    const response = await route(request('https://attacker.example'));

    expect(response.status).toBe(403);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(resolveSession).not.toHaveBeenCalled();
  });

  it('answers trusted product preflight requests without starting authorization', async () => {
    const { createPlatformAuthorizationOptionsRoute } = await import(
      '@/app/api/v1/authorize/route'
    );
    const route = createPlatformAuthorizationOptionsRoute(config);
    const response = route(new Request('http://localhost:3000/api/v1/authorize', {
      method: 'OPTIONS',
      headers: { origin: 'http://localhost:4173' },
    }));

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:4173');
    expect(response.headers.get('access-control-allow-methods')).toBe('POST, OPTIONS');
  });
});
