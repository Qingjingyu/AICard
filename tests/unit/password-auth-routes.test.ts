import { describe, expect, it, vi } from 'vitest';

const card = {
  principalId: '018f4f5d-8f6a-7a13-8e2c-1f21f3489a40',
  principalType: 'human' as const,
  cardId: 'AI_100001',
  handle: 'subai_account',
  displayName: '苏白',
  avatarUrl: null,
  bio: null,
  status: 'active' as const,
  createdAt: new Date('2026-08-13T00:00:00.000Z'),
  updatedAt: new Date('2026-08-13T00:00:00.000Z'),
};

const config = {
  nodeEnv: 'test' as const,
  appOrigin: 'http://localhost:3000',
  trustedProductOrigins: ['http://localhost:4173'],
};

describe('password registration route', () => {
  it('requires an idempotency header and never calls the service without it', async () => {
    const { createPasswordRegistrationRoute } = await import(
      '@/app/api/v1/auth/password/register/route'
    );
    const register = vi.fn();
    const POST = createPasswordRegistrationRoute({
      register,
      beforeRequest: vi.fn(),
      config,
    });
    const response = await POST(new Request('http://localhost:3000/api/v1/auth/password/register', {
      method: 'POST',
      headers: { origin: config.appOrigin, 'content-type': 'application/json' },
      body: JSON.stringify({
        clientId: 'yoyoo_dev',
        displayName: '苏白',
        handle: 'subai_account',
        password: 'correct horse 电池 staple',
      }),
    }));

    expect(response.status).toBe(400);
    expect(register).not.toHaveBeenCalled();
  });

  it('returns only the public account result and sets strict session cookies', async () => {
    const { createPasswordRegistrationRoute } = await import(
      '@/app/api/v1/auth/password/register/route'
    );
    const register = vi.fn().mockResolvedValue({
      card,
      replayed: false,
      sessionToken: 'a'.repeat(43),
      csrfToken: 'b'.repeat(43),
    });
    const POST = createPasswordRegistrationRoute({
      register,
      beforeRequest: vi.fn().mockResolvedValue(undefined),
      config,
    });
    const response = await POST(new Request('http://localhost:3000/api/v1/auth/password/register', {
      method: 'POST',
      headers: {
        origin: config.appOrigin,
        'content-type': 'application/json',
        'idempotency-key': 'register_route_test_key_000000001',
      },
      body: JSON.stringify({
        clientId: 'yoyoo_dev',
        displayName: '苏白',
        handle: 'subai_account',
        password: 'correct horse 电池 staple',
      }),
    }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toEqual({
      card: { card_id: 'AI_100001', handle: 'subai_account', display_name: '苏白' },
      replayed: false,
      csrf_token: 'b'.repeat(43),
    });
    expect(JSON.stringify(body)).not.toMatch(/principal|password|session/i);
    expect(response.headers.getSetCookie().join(';')).toContain('aicard_session=');
    expect(response.headers.getSetCookie().join(';')).toContain('HttpOnly');
    expect(response.headers.getSetCookie().join(';').toLowerCase()).toContain('samesite=strict');
  });
});

describe('password login route', () => {
  it('runs rate limiting before authentication and sets a rotated session', async () => {
    const { createPasswordLoginRoute } = await import('@/app/api/v1/auth/password/login/route');
    const beforeRequest = vi.fn().mockResolvedValue(undefined);
    const login = vi.fn().mockResolvedValue({
      card,
      sessionToken: 'c'.repeat(43),
      csrfToken: 'd'.repeat(43),
    });
    const POST = createPasswordLoginRoute({ login, beforeRequest, config });
    const response = await POST(new Request('http://localhost:3000/api/v1/auth/password/login', {
      method: 'POST',
      headers: { origin: config.appOrigin, 'content-type': 'application/json' },
      body: JSON.stringify({ identifier: 'AI_100001', password: 'correct horse 电池 staple' }),
    }));

    expect(response.status).toBe(200);
    expect(beforeRequest).toHaveBeenCalledWith('AI_100001');
    expect(login).toHaveBeenCalledOnce();
    expect(await response.json()).toEqual({
      card: { card_id: 'AI_100001', handle: 'subai_account', display_name: '苏白' },
      csrf_token: 'd'.repeat(43),
    });
  });

  it('accepts an exact trusted product origin and returns credentialed CORS headers', async () => {
    const { createPasswordLoginRoute } = await import('@/app/api/v1/auth/password/login/route');
    const login = vi.fn().mockResolvedValue({
      card,
      sessionToken: 'c'.repeat(43),
      csrfToken: 'd'.repeat(43),
    });
    const POST = createPasswordLoginRoute({
      login,
      beforeRequest: vi.fn().mockResolvedValue(undefined),
      config,
    });
    const response = await POST(new Request('http://localhost:3000/api/v1/auth/password/login', {
      method: 'POST',
      headers: { origin: 'http://localhost:4173', 'content-type': 'application/json' },
      body: JSON.stringify({ identifier: 'AI_100001', password: 'correct horse 电池 staple' }),
    }));

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('http://localhost:4173');
    expect(response.headers.get('access-control-allow-credentials')).toBe('true');
    expect(response.headers.get('vary')).toContain('Origin');
  });

  it('rejects an origin outside the exact allowlist before authentication', async () => {
    const { createPasswordLoginRoute } = await import('@/app/api/v1/auth/password/login/route');
    const login = vi.fn();
    const POST = createPasswordLoginRoute({ login, beforeRequest: vi.fn(), config });
    const response = await POST(new Request('http://localhost:3000/api/v1/auth/password/login', {
      method: 'POST',
      headers: { origin: 'https://attacker.example', 'content-type': 'application/json' },
      body: JSON.stringify({ identifier: 'AI_100001', password: 'not-used' }),
    }));

    expect(response.status).toBe(403);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
    expect(login).not.toHaveBeenCalled();
  });
});
