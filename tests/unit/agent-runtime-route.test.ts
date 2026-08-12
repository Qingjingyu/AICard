import { describe, expect, it, vi } from 'vitest';

import { PlatformAccessTokenError } from '@/server/authorization/errors';

describe('Agent runtime introspection route', () => {
  it('rejects a missing Bearer token without calling the service', async () => {
    const { createAgentRuntimeIntrospectionRoute } = await import(
      '@/app/api/v1/agent-runtime/introspect/route'
    );
    const introspectRuntimeToken = vi.fn();
    const POST = createAgentRuntimeIntrospectionRoute({
      beforeRequest: vi.fn().mockResolvedValue(undefined),
      introspectRuntimeToken,
    });

    const response = await POST(new Request('http://localhost/api/v1/agent-runtime/introspect', {
      method: 'POST',
    }));

    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(introspectRuntimeToken).not.toHaveBeenCalled();
  });

  it('returns only the active runtime claims for a valid token', async () => {
    const { createAgentRuntimeIntrospectionRoute } = await import(
      '@/app/api/v1/agent-runtime/introspect/route'
    );
    const token = `at_${'a'.repeat(43)}`;
    const introspectRuntimeToken = vi.fn().mockResolvedValue({
      active: true,
      subject: `sub_${'b'.repeat(43)}`,
      nodeId: '019f78ba-6ea8-7e85-bdaf-05b5fe7aa0a1',
      clientId: 'yoyoo_dev',
      audience: 'yoyoo',
      scope: 'agent.runtime',
      expiresAt: new Date('2026-08-09T12:00:00.000Z'),
    });
    const POST = createAgentRuntimeIntrospectionRoute({
      beforeRequest: vi.fn().mockResolvedValue(undefined),
      introspectRuntimeToken,
    });

    const response = await POST(new Request('http://localhost/api/v1/agent-runtime/introspect', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      active: true,
      sub: `sub_${'b'.repeat(43)}`,
      node_id: '019f78ba-6ea8-7e85-bdaf-05b5fe7aa0a1',
      client_id: 'yoyoo_dev',
      audience: 'yoyoo',
      scope: 'agent.runtime',
      expires_at: '2026-08-09T12:00:00.000Z',
    });
    expect(introspectRuntimeToken).toHaveBeenCalledWith(token);
    expect(JSON.stringify(body)).not.toContain(token);
  });

  it('fails closed for an expired or revoked runtime token', async () => {
    const { createAgentRuntimeIntrospectionRoute } = await import(
      '@/app/api/v1/agent-runtime/introspect/route'
    );
    const POST = createAgentRuntimeIntrospectionRoute({
      beforeRequest: vi.fn().mockResolvedValue(undefined),
      introspectRuntimeToken: vi.fn().mockRejectedValue(new PlatformAccessTokenError()),
    });

    const response = await POST(new Request('http://localhost/api/v1/agent-runtime/introspect', {
      method: 'POST',
      headers: { authorization: `Bearer at_${'a'.repeat(43)}` },
    }));

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({
      error: { code: 'AUTHENTICATION_REQUIRED', retryable: false },
    });
  });
});
