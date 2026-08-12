import { createHealthReport } from '@/server/health';
import { getServerConfig } from '@/server/config';
import { checkPostgres, createPostgresPool } from '@/server/postgres/pool';

export const dynamic = 'force-dynamic';

type DatabaseCheck = () => Promise<{ latencyMs: number }>;

let databasePool: ReturnType<typeof createPostgresPool> | undefined;

async function checkConfiguredDatabase() {
  const config = getServerConfig();
  databasePool ??= createPostgresPool(config.databaseUrl);
  return checkPostgres(databasePool);
}

export function createHealthRoute(checkDatabase: DatabaseCheck) {
  return async function healthRoute(): Promise<Response> {
    const report = await createHealthReport({ checkDatabase });

    return Response.json(report.body, {
      status: report.httpStatus,
      headers: {
        'cache-control': 'no-store',
      },
    });
  };
}

export const GET = createHealthRoute(checkConfiguredDatabase);
