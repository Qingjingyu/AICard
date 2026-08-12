import type { HealthReport } from '@/lib/contracts/health';

type HealthDependencies = {
  checkDatabase: () => Promise<{ latencyMs: number }>;
  now?: () => Date;
  startedAt?: Date;
};

const processStartedAt = new Date(Date.now() - process.uptime() * 1_000);

export async function createHealthReport({
  checkDatabase,
  now = () => new Date(),
  startedAt = processStartedAt,
}: HealthDependencies): Promise<HealthReport> {
  const checkedAt = now();
  const uptimeSeconds = Math.max(0, Math.floor((checkedAt.getTime() - startedAt.getTime()) / 1_000));

  try {
    const database = await checkDatabase();

    return {
      httpStatus: 200,
      body: {
        service: 'ai-card',
        status: 'ok',
        timestamp: checkedAt.toISOString(),
        uptimeSeconds,
        database: { status: 'up', latencyMs: database.latencyMs },
      },
    };
  } catch {
    return {
      httpStatus: 503,
      body: {
        service: 'ai-card',
        status: 'degraded',
        timestamp: checkedAt.toISOString(),
        uptimeSeconds,
        database: { status: 'down', code: 'DATABASE_UNAVAILABLE' },
      },
    };
  }
}
