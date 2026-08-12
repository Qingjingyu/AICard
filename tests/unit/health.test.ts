import { describe, expect, it } from 'vitest';

describe('health report', () => {
  it('reports success when PostgreSQL responds', async () => {
    const { createHealthReport } = await import('@/server/health');

    const result = await createHealthReport({
      checkDatabase: async () => ({ latencyMs: 7 }),
      now: () => new Date('2026-08-08T10:00:00.000Z'),
      startedAt: new Date('2026-08-08T09:59:30.000Z'),
    });

    expect(result).toEqual({
      httpStatus: 200,
      body: {
        service: 'ai-card',
        status: 'ok',
        timestamp: '2026-08-08T10:00:00.000Z',
        uptimeSeconds: 30,
        database: { status: 'up', latencyMs: 7 },
      },
    });
  });

  it('reports a safe degraded response when PostgreSQL fails', async () => {
    const { createHealthReport } = await import('@/server/health');

    const result = await createHealthReport({
      checkDatabase: async () => {
        throw new Error('password=do-not-expose host=internal-db');
      },
      now: () => new Date('2026-08-08T10:00:00.000Z'),
      startedAt: new Date('2026-08-08T09:59:30.000Z'),
    });

    expect(result.httpStatus).toBe(503);
    expect(result.body).toEqual({
      service: 'ai-card',
      status: 'degraded',
      timestamp: '2026-08-08T10:00:00.000Z',
      uptimeSeconds: 30,
      database: { status: 'down', code: 'DATABASE_UNAVAILABLE' },
    });
    expect(JSON.stringify(result)).not.toContain('do-not-expose');
    expect(JSON.stringify(result)).not.toContain('internal-db');
  });
});
