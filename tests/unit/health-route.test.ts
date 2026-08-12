import { describe, expect, it } from 'vitest';

describe('health route', () => {
  it('returns the health report status and disables caching', async () => {
    const { createHealthRoute } = await import('@/app/api/health/route');
    const GET = createHealthRoute(async () => ({ latencyMs: 3 }));

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({
      service: 'ai-card',
      status: 'ok',
      database: { status: 'up', latencyMs: 3 },
    });
  });

  it('uses 503 for a failed database dependency', async () => {
    const { createHealthRoute } = await import('@/app/api/health/route');
    const GET = createHealthRoute(async () => {
      throw new Error('private database detail');
    });

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.database).toEqual({ status: 'down', code: 'DATABASE_UNAVAILABLE' });
    expect(JSON.stringify(body)).not.toContain('private database detail');
  });
});
