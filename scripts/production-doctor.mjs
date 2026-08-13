import pg from 'pg';
import { fileURLToPath } from 'node:url';

const { Client } = pg;
const requiredScopes = ['card.basic', 'card.handle', 'card.id', 'offline_access', 'agent.runtime'];
const requiredMigrationCount = 14;

function check(id, condition, message) {
  return { id, status: condition ? 'pass' : 'fail', message };
}

function isHttps(value) {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

export function inspectProductionReadiness(environment, database) {
  const yoyooClientId = environment.AICARD_PRODUCTION_YOYOO_CLIENT_ID ?? '';
  const yoyooRedirect = environment.AICARD_PRODUCTION_YOYOO_REDIRECT_URI ?? '';
  const yoyooClient = database.clients.find((client) => client.clientId === yoyooClientId);
  const expectedHost = (() => {
    try {
      return new URL(environment.APP_ORIGIN ?? '').hostname;
    } catch {
      return '';
    }
  })();
  const checks = [
    check(
      'environment.production',
      environment.NODE_ENV === 'production',
      'NODE_ENV is production',
    ),
    check(
      'origin.public_https',
      isHttps(environment.APP_ORIGIN)
        && environment.APP_ORIGIN === environment.WEBAUTHN_ORIGIN
        && environment.WEBAUTHN_RP_ID === expectedHost,
      'APP_ORIGIN, WEBAUTHN_ORIGIN and RP ID describe one HTTPS identity authority',
    ),
    check(
      'database.configured',
      /^postgres(?:ql)?:\/\//.test(environment.DATABASE_URL ?? ''),
      'A PostgreSQL production database is configured',
    ),
    check(
      'yoyoo.client_id',
      /^[a-z][a-z0-9_-]{2,63}$/.test(yoyooClientId) && yoyooClientId !== 'yoyoo_dev',
      'A dedicated non-development Yoyoo client ID is configured',
    ),
    check(
      'yoyoo.redirect_https',
      isHttps(yoyooRedirect),
      'The expected Yoyoo callback uses HTTPS',
    ),
    check(
      'database.migrations',
      database.migrations.length >= requiredMigrationCount,
      `At least ${requiredMigrationCount} checksum-tracked migrations are applied`,
    ),
    check(
      'yoyoo.client',
      yoyooClient?.status === 'active' && yoyooClient.audience === 'yoyoo',
      'The Yoyoo client is active with the expected audience',
    ),
    check(
      'yoyoo.redirect_exact',
      Boolean(yoyooClient && yoyooClient.redirectUris.includes(yoyooRedirect)),
      'The exact production Yoyoo callback is registered',
    ),
    check(
      'yoyoo.scopes',
      Boolean(yoyooClient && requiredScopes.every((scope) => yoyooClient.scopes.includes(scope))),
      'The Yoyoo client has the required unified-login scopes',
    ),
  ];
  return { ok: checks.every((item) => item.status === 'pass'), checks };
}

export async function readDatabaseSnapshot(databaseUrl) {
  const client = new Client({
    connectionString: databaseUrl,
    application_name: 'aicard-production-doctor',
    statement_timeout: 5_000,
  });
  await client.connect();
  try {
    const [migrations, clients] = await Promise.all([
      client.query('select name from aicard_schema_migrations order by name'),
      client.query(`
        select clients.client_id, clients.audience, clients.status,
               coalesce(array_agg(distinct redirects.redirect_uri)
                 filter (where redirects.redirect_uri is not null), '{}') as redirect_uris,
               coalesce(array_agg(distinct scopes.scope)
                 filter (where scopes.scope is not null), '{}') as scopes
        from platform_clients clients
        left join platform_client_redirect_uris redirects using (client_id)
        left join platform_client_scopes scopes using (client_id)
        group by clients.client_id, clients.audience, clients.status
        order by clients.client_id
      `),
    ]);
    return {
      migrations: migrations.rows.map((row) => row.name),
      clients: clients.rows.map((row) => ({
        clientId: row.client_id,
        audience: row.audience,
        status: row.status,
        redirectUris: row.redirect_uris,
        scopes: row.scopes,
      })),
    };
  } finally {
    await client.end();
  }
}

async function main() {
  const configurationReport = inspectProductionReadiness(process.env, {
    migrations: [],
    clients: [],
  });
  const configurationChecks = configurationReport.checks.slice(0, 5);
  if (configurationChecks.some((item) => item.status === 'fail')) {
    const report = { ok: false, checks: configurationChecks };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = 1;
    return;
  }

  let report;
  try {
    const database = await readDatabaseSnapshot(process.env.DATABASE_URL);
    report = inspectProductionReadiness(process.env, database);
  } catch (error) {
    const databaseUrl = process.env.DATABASE_URL;
    const rawMessage = error instanceof Error ? error.message : 'Database check failed';
    report = {
      ok: false,
      checks: [...configurationChecks, {
        id: 'database.readiness',
        status: 'fail',
        message: databaseUrl ? rawMessage.replaceAll(databaseUrl, '[redacted]') : rawMessage,
      }],
    };
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
