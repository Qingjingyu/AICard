import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { access, cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';
import pg from 'pg';
import { v7 as uuidv7 } from 'uuid';

const { Client } = pg;
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const aicardRoot = resolve(scriptDirectory, '..');
const yoyooRoot = resolve(
  process.env.YOYOO_REPOSITORY ?? resolve(aicardRoot, '../Yoyoo'),
);
const containerName = `aicard-yoyoo-federation-${process.pid}`;
const postgresImage = process.env.AICARD_TEST_POSTGRES_IMAGE ?? 'postgres:17-alpine';
const postgresUser = 'federation_test';
const aicardDatabase = 'aicard_federation_test';
const yoyooDatabase = 'yoyoo_federation_test';
const postgresPassword = randomBytes(24).toString('base64url');
const aicardPort = Number(process.env.AICARD_FEDERATION_E2E_PORT ?? 4282);
const aicardInternalPort = Number(process.env.AICARD_FEDERATION_INTERNAL_PORT ?? 4283);
const yoyooPort = Number(process.env.YOYOO_FEDERATION_E2E_PORT ?? 4284);
const yoyooInternalPort = Number(process.env.YOYOO_FEDERATION_INTERNAL_PORT ?? 4285);
const aicardOrigin = `https://localhost:${aicardPort}`;
const yoyooOrigin = `https://localhost:${yoyooPort}`;
const ownerExternalKey = `federation-owner-${process.pid}`;
const handle = `yoyoo_federation_${Date.now().toString(36)}`;
const password = 'correct horse battery staple';
const childProcesses = [];
const proxyServers = [];
let certificateDirectory;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
  });
  if (result.status !== 0) {
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
    throw new Error(`${command} ${args.join(' ')} failed${output ? `: ${output}` : ''}`);
  }
  return options.capture ? result.stdout.trim() : '';
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitForPostgres() {
  const deadline = Date.now() + 60_000;
  let consecutiveReady = 0;
  while (Date.now() < deadline) {
    const result = spawnSync(
      'docker',
      ['exec', containerName, 'pg_isready', '--username', postgresUser, '--dbname', aicardDatabase],
      { encoding: 'utf8' },
    );
    consecutiveReady = result.status === 0 ? consecutiveReady + 1 : 0;
    if (consecutiveReady >= 3) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error('Ephemeral PostgreSQL did not become ready within 60 seconds');
}

async function waitForHttp(url, processName) {
  const deadline = Date.now() + 120_000;
  let lastError = 'no response';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: 'manual' });
      if (response.status < 500) return;
      lastError = `HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 300));
  }
  throw new Error(`${processName} did not become ready: ${lastError}`);
}

async function createTemporaryCertificate() {
  certificateDirectory = await mkdtemp(resolve(tmpdir(), 'aicard-yoyoo-federation-'));
  const keyPath = resolve(certificateDirectory, 'localhost.key');
  const certificatePath = resolve(certificateDirectory, 'localhost.crt');
  run('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', keyPath, '-out', certificatePath, '-days', '1',
    '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
  ], { capture: true });
  return {
    key: await readFile(keyPath),
    certificate: await readFile(certificatePath),
    certificatePath,
  };
}

async function startHttpsProxy({ port, targetPort, key, certificate }) {
  const server = createHttpsServer({ key, cert: certificate }, (incoming, outgoing) => {
    const host = `localhost:${port}`;
    const proxy = httpRequest({
      hostname: '127.0.0.1',
      port: targetPort,
      path: incoming.url,
      method: incoming.method,
      headers: {
        ...incoming.headers,
        host,
        'x-forwarded-host': host,
        'x-forwarded-proto': 'https',
      },
    }, (response) => {
      outgoing.writeHead(response.statusCode ?? 502, response.headers);
      response.pipe(outgoing);
    });
    proxy.on('error', (error) => {
      if (!outgoing.headersSent) outgoing.writeHead(502, { 'content-type': 'text/plain' });
      outgoing.end(`Proxy request failed: ${error.message}`);
    });
    incoming.pipe(proxy);
  });
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolvePromise);
  });
  proxyServers.push(server);
}

function start(command, args, options) {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const capture = (chunk) => {
    output = `${output}${chunk.toString()}`.slice(-8_000);
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  childProcesses.push({ child, name: options.name, output: () => output });
  return child;
}

async function stopChildren() {
  await Promise.all(childProcesses.map(({ child }) => new Promise((resolvePromise) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolvePromise();
      return;
    }
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
    }, 5_000);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolvePromise();
    });
    child.kill('SIGTERM');
  })));
}

async function stopProxies() {
  await Promise.all(proxyServers.map((server) => new Promise((resolvePromise) => {
    server.close(() => resolvePromise());
    server.closeAllConnections();
  })));
}

async function query(connectionString, text, values = []) {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    return await client.query(text, values);
  } finally {
    await client.end();
  }
}

async function assertAuthenticatedSession(page) {
  const response = await page.request.get(`${yoyooOrigin}/api/v1/auth/session`);
  assert(response.status() === 200, `Yoyoo session endpoint returned ${response.status()}`);
  const session = await response.json();
  assert(session.authenticated === true, 'Yoyoo did not establish an authenticated browser session');
  assert(session.identity?.aiCardId === 'AI_100001', 'Yoyoo session did not retain the authoritative Card ID');
}

async function postJson(request, url, body, headers = {}) {
  return request.post(url, {
    data: body,
    headers: {
      origin: new URL(url).origin,
      ...headers,
    },
  });
}

async function runAgentAcceptance(page, aicardDatabaseUrl, yoyooDatabaseUrl) {
  const agentHandle = `yoyoo_agent_${Date.now().toString(36)}`;
  const machineName = 'yoyoo-federation-agent';

  await page.goto(`${aicardOrigin}/me/card`);
  await page.getByLabel('中文昵称').fill('YOS 联邦验收 Agent');
  await page.getByLabel('@Handle', { exact: true }).last().fill(agentHandle);
  await page.getByRole('button', { name: '创建邀请' }).click();
  const instruction = page.getByRole('textbox', { name: '完整接入指令' });
  await instruction.waitFor();
  const instructionText = await instruction.inputValue();
  const invitationId = instructionText.match(/邀请 ID：([^\n]+)/)?.[1];
  const ticket = instructionText.match(/邀请票据：([^\n]+)/)?.[1];
  assert(invitationId && ticket, 'AI Card did not return a complete one-time Agent invitation');

  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeySpki = publicKey.export({ format: 'der', type: 'spki' }).toString('base64url');
  const claimId = uuidv7();
  const claimSecret = randomBytes(32).toString('base64url');
  const claimPayload = [
    'aicard-agent-claim-v1',
    invitationId,
    claimId,
    machineName,
    publicKeySpki,
  ].join('\n');
  const claimResponse = await postJson(
    page.request,
    `${aicardOrigin}/api/v1/agent-enrollment/claim`,
    {
      invitationId,
      ticket,
      claimId,
      claimSecret,
      machineName,
      publicKey: publicKeySpki,
      signature: sign(null, Buffer.from(claimPayload, 'utf8'), privateKey).toString('base64url'),
    },
  );
  assert(claimResponse.status() === 200, `AI Card Agent claim returned ${claimResponse.status()}`);
  const claimed = await claimResponse.json();
  assert(claimed.cardId === 'AI_100002', 'The first controlled AI did not receive the next permanent Card ID');
  assert(claimed.connectionStatus === 'connected', 'The claimed AI Card node was not connected');

  await page.goto(`${yoyooOrigin}/settings/agents`);
  await page.locator('.agent-directory-header').getByRole('link', { name: '授权 AI 接入' }).click();
  await page.getByRole('heading', { name: '允许 Yoyoo 认识你？' }).waitFor();
  await page.getByText('YOS 联邦验收 Agent', { exact: true }).waitFor();
  await page.getByRole('button', { name: '允许访问' }).click();
  await page.waitForURL((url) => (
    url.origin === yoyooOrigin
    && url.pathname === '/settings/agents'
    && url.searchParams.get('aicard') === 'agent_connected'
  ));

  const firstMapping = await query(
    yoyooDatabaseUrl,
    `select mappings.principal_id, mappings.card_id, mappings.subject,
            principals.kind,
            (select count(*)::int from aicard_identity_mappings
              where issuer = $1 and client_id = 'yoyoo_dev' and card_id = $2) as mapping_count,
            (select count(*)::int from agent_gateway_credentials
              where principal_id = mappings.principal_id) as credential_count
       from aicard_identity_mappings mappings
       join principals on principals.id = mappings.principal_id
      where mappings.issuer = $1 and mappings.client_id = 'yoyoo_dev'
        and mappings.card_id = $2`,
    [aicardOrigin, claimed.cardId],
  );
  assert(firstMapping.rowCount === 1, 'Yoyoo did not create exactly one mapping for the authorized AI Card');
  assert(firstMapping.rows[0].kind === 'agent', 'The authorized AI Card was not mapped as an Agent Principal');
  assert(firstMapping.rows[0].mapping_count === 1, 'The authorized AI Card created duplicate Yoyoo mappings');
  assert(firstMapping.rows[0].credential_count === 0, 'Yoyoo created a legacy yya_ credential for the AI Card');
  const agentPrincipalId = firstMapping.rows[0].principal_id;
  const originalSubject = firstMapping.rows[0].subject;

  const challengeResponse = await postJson(
    page.request,
    `${aicardOrigin}/api/v1/agent-nodes/challenge`,
    { nodeId: claimed.nodeId },
  );
  assert(challengeResponse.status() === 200, `AI Card runtime challenge returned ${challengeResponse.status()}`);
  const challenge = await challengeResponse.json();
  const runtimePayload = [
    'aicard-agent-runtime-v1',
    claimed.nodeId,
    'yoyoo_dev',
    challenge.challenge,
  ].join('\n');
  const runtimeResponse = await postJson(
    page.request,
    `${aicardOrigin}/api/v1/agent-nodes/authenticate`,
    {
      nodeId: claimed.nodeId,
      clientId: 'yoyoo_dev',
      challengeId: challenge.challengeId,
      challenge: challenge.challenge,
      signature: sign(null, Buffer.from(runtimePayload, 'utf8'), privateKey).toString('base64url'),
    },
  );
  assert(runtimeResponse.status() === 200, `AI Card runtime authentication returned ${runtimeResponse.status()}`);
  const runtime = await runtimeResponse.json();
  assert(runtime.runtime?.audience === 'yoyoo', 'AI Card issued the runtime token for the wrong audience');
  const authorization = `Bearer ${runtime.runtime.accessToken}`;

  const heartbeat = await postJson(
    page.request,
    `${yoyooOrigin}/api/v1/agent-gateway/heartbeat`,
    {},
    { authorization },
  );
  assert(heartbeat.status() === 200, `Yoyoo rejected the AI Card runtime token with ${heartbeat.status()}`);
  const heartbeatBody = await heartbeat.json();
  assert(heartbeatBody.agent.principalId === agentPrincipalId, 'Runtime authentication resolved the wrong Yoyoo Principal');

  const roomResponse = await postJson(
    page.request,
    `${yoyooOrigin}/api/v1/rooms`,
    { name: 'YOS 联邦验收房间' },
    { 'Idempotency-Key': `federation-room-${uuidv7()}` },
  );
  assert(roomResponse.status() === 201, `Yoyoo room creation returned ${roomResponse.status()}`);
  const createdRoom = await roomResponse.json();
  const roomId = createdRoom.room.id;
  const addMemberResponse = await postJson(
    page.request,
    `${yoyooOrigin}/api/v1/rooms/${roomId}/members`,
    { principalId: agentPrincipalId },
  );
  assert(addMemberResponse.status() === 200, `Yoyoo Agent room admission returned ${addMemberResponse.status()}`);

  const directoryResponse = await page.request.get(`${yoyooOrigin}/api/v1/agent-gateway/directory`, {
    headers: { authorization },
  });
  assert(directoryResponse.status() === 200, `Yoyoo Agent directory returned ${directoryResponse.status()}`);
  const directory = await directoryResponse.json();
  assert(directory.self.principalId === agentPrincipalId, 'Agent directory resolved the wrong self Principal');
  assert(directory.rooms.some((room) => room.roomId === roomId), 'Agent directory omitted the explicitly authorized room ID');

  const messageResponse = await postJson(
    page.request,
    `${yoyooOrigin}/api/v1/agent-gateway/rooms/${roomId}/messages`,
    {
      content: 'YOS 已通过自己的 AI Card 接入并提供服务。',
      mentionedPrincipalIds: [],
    },
    {
      authorization,
      'Idempotency-Key': `federation-message-${uuidv7()}`,
    },
  );
  assert(messageResponse.status() === 202, `Yoyoo rejected the AI Card Agent message with ${messageResponse.status()}`);
  const storedMessage = await query(
    yoyooDatabaseUrl,
    `select sender_principal_id, room_id, content
       from room_messages
      where room_id = $1 and sender_principal_id = $2`,
    [roomId, agentPrincipalId],
  );
  assert(storedMessage.rowCount === 1, 'The authorized AI Card Agent message was not stored exactly once');

  await page.goto(`${yoyooOrigin}/settings/agents`);
  await page.locator('.agent-directory-header').getByRole('link', { name: '授权 AI 接入' }).click();
  await page.getByText('YOS 联邦验收 Agent', { exact: true }).waitFor();
  await page.getByRole('button', { name: '允许访问' }).click();
  await page.waitForURL((url) => url.origin === yoyooOrigin && url.searchParams.get('aicard') === 'agent_connected');
  const reusedMapping = await query(
    yoyooDatabaseUrl,
    `select principal_id, subject,
            (select count(*)::int from aicard_identity_mappings
              where issuer = $1 and client_id = 'yoyoo_dev' and card_id = $2) as mapping_count
       from aicard_identity_mappings
      where issuer = $1 and client_id = 'yoyoo_dev' and card_id = $2`,
    [aicardOrigin, claimed.cardId],
  );
  assert(reusedMapping.rowCount === 1, 'Repeated Agent authorization created another mapping');
  assert(reusedMapping.rows[0].principal_id === agentPrincipalId, 'Repeated Agent authorization changed the Yoyoo Principal');
  assert(reusedMapping.rows[0].subject === originalSubject, 'Repeated Agent authorization changed the pairwise Subject');
  assert(reusedMapping.rows[0].mapping_count === 1, 'Repeated Agent authorization duplicated the mapping');

  const cardResult = await query(
    aicardDatabaseUrl,
    `select cards.card_id, principals.principal_type, nodes.node_id
       from card_handles handles
       join ai_cards cards on cards.card_id = handles.card_id
       join principals on principals.principal_id = cards.principal_id
       join agent_nodes nodes on nodes.principal_id = cards.principal_id
      where handles.handle = $1 and handles.is_current`,
    [agentHandle],
  );
  assert(cardResult.rowCount === 1, 'AI Card did not retain exactly one claimed YOS identity');
  assert(cardResult.rows[0].principal_type === 'ai', 'The claimed YOS Card is not an AI identity');
  assert(cardResult.rows[0].node_id === claimed.nodeId, 'The YOS runtime node moved to another AI Card');
}

async function runBrowserAcceptance(aicardDatabaseUrl, yoyooDatabaseUrl) {
  const browser = await chromium.launch();
  try {
    const firstContext = await browser.newContext({ ignoreHTTPSErrors: true });
    const firstPage = await firstContext.newPage();
    await firstPage.goto(`${yoyooOrigin}/login`);
    await firstPage.getByRole('link', { name: '使用 AI Card 继续' }).click();
    await firstPage.getByRole('heading', { name: '你的 AI 时代身份' }).waitFor();
    await firstPage.getByLabel('昵称').fill('Yoyoo 联邦验收用户');
    await firstPage.getByLabel('@Handle').fill(handle);
    await firstPage.getByLabel('密码').fill(password);
    await firstPage.getByRole('button', { name: '创建 AI Card', exact: true }).last().click();
    await firstPage.getByRole('heading', { name: '允许 Yoyoo 认识你？' }).waitFor();
    await firstPage.getByRole('button', { name: '允许访问' }).click();
    await firstPage.waitForURL((url) => url.origin === yoyooOrigin && url.searchParams.get('aicard') === 'connected');
    await assertAuthenticatedSession(firstPage);

    const cardResult = await query(
      aicardDatabaseUrl,
      `select cards.card_id, registrations.client_id
       from card_handles handles
       join ai_cards cards on cards.card_id = handles.card_id
       join account_registration_requests registrations
         on registrations.principal_id = cards.principal_id
       where handles.handle = $1 and handles.is_current`,
      [handle],
    );
    assert(cardResult.rowCount === 1, 'AI Card registration did not create exactly one identity');
    assert(cardResult.rows[0].card_id === 'AI_100001', 'First isolated registration was not AI_100001');
    assert(cardResult.rows[0].client_id === 'yoyoo_dev', 'Registration source was not the verified Yoyoo client');

    const firstMapping = await query(
      yoyooDatabaseUrl,
      `select mappings.principal_id, mappings.card_id, mappings.subject,
              principals.external_key,
              (select count(*)::int from human_credentials) as credential_count,
              (select count(*)::int from principals where kind = 'human') as human_count
       from aicard_identity_mappings mappings
       join principals on principals.id = mappings.principal_id
       where mappings.issuer = $1 and mappings.client_id = 'yoyoo_dev'`,
      [aicardOrigin],
    );
    assert(firstMapping.rowCount === 1, 'Yoyoo did not create exactly one verified identity mapping');
    assert(firstMapping.rows[0].card_id === 'AI_100001', 'Yoyoo did not retain the authoritative Card ID');
    assert(
      firstMapping.rows[0].external_key === `human:${ownerExternalKey}`,
      'Yoyoo replaced the existing owner Principal',
    );
    assert(firstMapping.rows[0].credential_count === 0, 'Yoyoo created a second local credential');
    assert(firstMapping.rows[0].human_count === 1, 'Yoyoo created a duplicate human Principal');
    const originalPrincipalId = firstMapping.rows[0].principal_id;
    const originalSubject = firstMapping.rows[0].subject;
    await firstContext.close();

    const secondContext = await browser.newContext({ ignoreHTTPSErrors: true });
    const secondPage = await secondContext.newPage();
    await secondPage.goto(`${yoyooOrigin}/login`);
    await secondPage.getByRole('link', { name: '使用 AI Card 继续' }).click();
    await secondPage.getByRole('button', { name: '登录' }).click();
    await secondPage.getByLabel('AI Card ID 或 @Handle').fill('AI_100001');
    await secondPage.getByLabel('密码').fill(password);
    await secondPage.getByRole('button', { name: '登录', exact: true }).last().click();
    await secondPage.getByRole('heading', { name: '允许 Yoyoo 认识你？' }).waitFor();
    await secondPage.getByRole('button', { name: '允许访问' }).click();
    await secondPage.waitForURL((url) => url.origin === yoyooOrigin && url.searchParams.get('aicard') === 'connected');
    await assertAuthenticatedSession(secondPage);

    const reusedIdentity = await query(
      yoyooDatabaseUrl,
      `select mappings.principal_id, mappings.card_id, mappings.subject,
              (select count(*)::int from aicard_identity_mappings) as mapping_count,
              (select count(*)::int from principals where kind = 'human') as human_count,
              (select count(*)::int from human_sessions where auth_method = 'aicard') as session_count
       from aicard_identity_mappings mappings
       where mappings.issuer = $1 and mappings.client_id = 'yoyoo_dev'`,
      [aicardOrigin],
    );
    assert(reusedIdentity.rowCount === 1, 'Repeated login created a second Yoyoo mapping');
    assert(reusedIdentity.rows[0].principal_id === originalPrincipalId, 'Repeated login changed the Yoyoo Principal');
    assert(reusedIdentity.rows[0].subject === originalSubject, 'Repeated login changed the pairwise Subject');
    assert(reusedIdentity.rows[0].card_id === 'AI_100001', 'Repeated login changed the permanent Card ID');
    assert(reusedIdentity.rows[0].mapping_count === 1, 'Repeated login duplicated the identity mapping');
    assert(reusedIdentity.rows[0].human_count === 1, 'Repeated login duplicated the human Principal');
    assert(reusedIdentity.rows[0].session_count === 2, 'Each browser did not receive its own federated session');

    await runAgentAcceptance(secondPage, aicardDatabaseUrl, yoyooDatabaseUrl);
    await secondContext.close();
  } finally {
    await browser.close();
  }
}

async function main() {
  await access(resolve(yoyooRoot, 'package.json'));
  await readFile(resolve(aicardRoot, 'package.json'), 'utf8');

  run('docker', [
    'run', '--rm', '--detach', '--name', containerName,
    '--env', 'POSTGRES_USER', '--env', 'POSTGRES_PASSWORD', '--env', 'POSTGRES_DB',
    '--publish', '127.0.0.1::5432', postgresImage,
  ], {
    capture: true,
    env: {
      ...process.env,
      POSTGRES_USER: postgresUser,
      POSTGRES_PASSWORD: postgresPassword,
      POSTGRES_DB: aicardDatabase,
    },
  });
  await waitForPostgres();
  const portOutput = run('docker', ['port', containerName, '5432/tcp'], { capture: true });
  const postgresPort = portOutput.match(/:(\d+)$/)?.[1];
  if (!postgresPort) throw new Error(`Could not determine PostgreSQL port from ${portOutput}`);
  run('docker', ['exec', containerName, 'createdb', '--username', postgresUser, yoyooDatabase]);

  const aicardDatabaseUrl = `postgres://${postgresUser}:${encodeURIComponent(postgresPassword)}@127.0.0.1:${postgresPort}/${aicardDatabase}`;
  const yoyooDatabaseUrl = `postgres://${postgresUser}:${encodeURIComponent(postgresPassword)}@127.0.0.1:${postgresPort}/${yoyooDatabase}`;
  const certificate = await createTemporaryCertificate();
  const aicardEnvironment = {
    ...process.env,
    NODE_ENV: 'production',
    APP_ORIGIN: aicardOrigin,
    DATABASE_URL: aicardDatabaseUrl,
    WEBAUTHN_RP_NAME: 'AI Card',
    WEBAUTHN_RP_ID: 'localhost',
    WEBAUTHN_ORIGIN: aicardOrigin,
  };
  const yoyooEnvironment = {
    ...process.env,
    NODE_ENV: 'production',
    DATABASE_URL: yoyooDatabaseUrl,
    YOYOO_LOCAL_OWNER_ID: ownerExternalKey,
    YOYOO_HUMAN_AUTH_MODE: 'password',
    YOYOO_PUBLIC_ORIGIN: yoyooOrigin,
    YOYOO_AUTH_PEPPER: randomBytes(32).toString('base64url'),
    YOYOO_AICARD_ISSUER: aicardOrigin,
    YOYOO_AICARD_CLIENT_ID: 'yoyoo_dev',
    YOYOO_AICARD_REDIRECT_URI: `${yoyooOrigin}/auth/aicard/callback`,
    YOYOO_AICARD_SESSION_SECRET: randomBytes(32).toString('base64url'),
    YOYOO_BUILTIN_AGENTS: 'none',
    NODE_EXTRA_CA_CERTS: certificate.certificatePath,
  };

  run('npm', ['run', 'db:migrate'], { cwd: aicardRoot, env: aicardEnvironment });
  run(process.execPath, ['scripts/db-migrate.mjs'], { cwd: yoyooRoot, env: yoyooEnvironment });
  await query(
    aicardDatabaseUrl,
    `insert into platform_client_redirect_uris (client_id, redirect_uri)
     values ('yoyoo_dev', $1)
     on conflict do nothing`,
    [`${yoyooOrigin}/auth/aicard/callback`],
  );
  run('npm', ['run', 'build'], { cwd: aicardRoot, env: aicardEnvironment });
  run('npm', ['run', 'build'], { cwd: yoyooRoot, env: yoyooEnvironment });
  await cp(resolve(yoyooRoot, '.next/static'), resolve(yoyooRoot, '.next/standalone/.next/static'), {
    recursive: true,
    force: true,
  });
  await cp(resolve(yoyooRoot, 'public'), resolve(yoyooRoot, '.next/standalone/public'), {
    recursive: true,
    force: true,
  });

  start(
    process.execPath,
    ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(aicardInternalPort)],
    { cwd: aicardRoot, env: aicardEnvironment, name: 'AI Card' },
  );
  start(
    process.execPath,
    ['.next/standalone/server.js'],
    {
      cwd: yoyooRoot,
      env: {
        ...yoyooEnvironment,
        HOSTNAME: '127.0.0.1',
        PORT: String(yoyooInternalPort),
      },
      name: 'Yoyoo',
    },
  );
  await Promise.all([
    startHttpsProxy({
      port: aicardPort,
      targetPort: aicardInternalPort,
      key: certificate.key,
      certificate: certificate.certificate,
    }),
    startHttpsProxy({
      port: yoyooPort,
      targetPort: yoyooInternalPort,
      key: certificate.key,
      certificate: certificate.certificate,
    }),
  ]);
  await Promise.all([
    waitForHttp(`http://127.0.0.1:${aicardInternalPort}/api/health`, 'AI Card'),
    waitForHttp(`http://127.0.0.1:${yoyooInternalPort}/api/health`, 'Yoyoo'),
  ]);
  for (const processState of childProcesses) {
    if (processState.child.exitCode !== null) {
      throw new Error(`${processState.name} exited before acceptance:\n${processState.output()}`);
    }
  }

  await runBrowserAcceptance(aicardDatabaseUrl, yoyooDatabaseUrl);
  process.stdout.write('AI Card -> Yoyoo human and YOS Agent federation acceptance passed.\n');
}

try {
  await main();
} catch (error) {
  for (const processState of childProcesses) {
    if (processState.output()) {
      process.stderr.write(`\n[${processState.name}]\n${processState.output()}\n`);
    }
  }
  throw error;
} finally {
  await stopProxies();
  await stopChildren();
  spawnSync('docker', ['rm', '--force', containerName], { stdio: 'ignore' });
  if (certificateDirectory) await rm(certificateDirectory, { recursive: true, force: true });
}
