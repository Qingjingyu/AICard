import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';

import { createStableReadinessTracker } from './postgres-readiness.mjs';

const containerName = `aicard-postgres-${process.pid}`;
const image = process.env.AICARD_TEST_POSTGRES_IMAGE ?? 'postgres:17-alpine';
const user = 'aicard_test';
const database = 'aicard_test';
const password = randomBytes(24).toString('base64url');

function run(command, args, { capture = false, ...options } = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
    ...options,
  });

  if (result.status !== 0) {
    const details = capture ? `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() : '';
    throw new Error(`${command} ${args.join(' ')} failed${details ? `: ${details}` : ''}`);
  }

  return capture ? result.stdout.trim() : '';
}

function cleanup() {
  spawnSync('docker', ['rm', '--force', containerName], { stdio: 'ignore' });
}

try {
  run('docker', [
    'run',
    '--rm',
    '--detach',
    '--name',
    containerName,
    '--env',
    'POSTGRES_USER',
    '--env',
    'POSTGRES_PASSWORD',
    '--env',
    'POSTGRES_DB',
    '--publish',
    '127.0.0.1::5432',
    image,
  ], {
    capture: true,
    env: {
      ...process.env,
      POSTGRES_USER: user,
      POSTGRES_PASSWORD: password,
      POSTGRES_DB: database,
    },
  });

  let portOutput = '';
  let port;
  const portDeadline = Date.now() + 5_000;
  while (!port && Date.now() < portDeadline) {
    portOutput = run('docker', ['port', containerName, '5432/tcp'], { capture: true });
    port = portOutput.match(/:(\d+)$/)?.[1];
    if (!port) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!port) throw new Error(`Could not determine PostgreSQL port from: ${portOutput}`);

  const deadline = Date.now() + 60_000;
  const probeDiagnostics = new Map();
  const readiness = createStableReadinessTracker(3);
  let isReady = false;
  while (Date.now() < deadline) {
    const ready = spawnSync('docker', ['exec', containerName, 'pg_isready', '--username', user, '--dbname', database], {
      encoding: 'utf8',
    });
    const probeKey = JSON.stringify({
      status: ready.status,
      signal: ready.signal,
      error: ready.error?.code,
      stdout: ready.stdout?.trim(),
      stderr: ready.stderr?.trim(),
    });
    probeDiagnostics.set(probeKey, (probeDiagnostics.get(probeKey) ?? 0) + 1);
    if (readiness.observe(ready.status)) {
      isReady = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  if (!isReady) {
    const state = spawnSync('docker', ['inspect', containerName, '--format', '{{json .State}}'], {
      encoding: 'utf8',
    }).stdout.trim();
    const logs = spawnSync('docker', ['logs', '--tail', '60', containerName], {
      encoding: 'utf8',
    });
    const logOutput = `${logs.stdout ?? ''}${logs.stderr ?? ''}`.trim();
    const probes = [...probeDiagnostics.entries()]
      .map(([result, count]) => `${count}x ${result}`)
      .join('\n');
    throw new Error(
      `PostgreSQL did not become ready within 60 seconds. State: ${state || 'unavailable'}\n`
      + `Probe results:\n${probes || 'unavailable'}\n${logOutput}`,
    );
  }

  const databaseUrl = `postgres://${user}:${encodeURIComponent(password)}@127.0.0.1:${port}/${database}`;
  const testEnvironment = {
    ...process.env,
    NODE_ENV: 'test',
    APP_ORIGIN: 'http://localhost:3000',
    DATABASE_URL: databaseUrl,
    TEST_DATABASE_URL: databaseUrl,
    WEBAUTHN_RP_NAME: 'AI Card',
    WEBAUTHN_RP_ID: 'localhost',
    WEBAUTHN_ORIGIN: 'http://localhost:3000',
  };
  run('npm', ['run', 'db:migrate'], { env: testEnvironment });
  run('node_modules/.bin/vitest', ['run', '--no-file-parallelism', 'tests/integration'], {
    env: testEnvironment,
  });
} finally {
  cleanup();
}
