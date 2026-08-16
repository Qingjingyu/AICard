import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import { PlatformClientRegistrationService } from '../src/server/authorization/platform-client-registration-service';
import { createPostgresPool } from '../src/server/postgres/pool';
import { PostgresPlatformClientRepository } from '../src/server/postgres/platform-client-repository';

const supportedScopes = [
  'card.basic',
  'card.handle',
  'card.id',
  'offline_access',
  'agent.runtime',
  'agent.enroll',
] as const;

const documentSchema = z.object({
  clientId: z.string(),
  displayName: z.string(),
  audience: z.string(),
  redirectUris: z.array(z.string()),
  scopes: z.array(z.enum(supportedScopes)),
}).strict();

export function parsePlatformClientDocument(contents: string) {
  return documentSchema.parse(JSON.parse(contents));
}

async function main() {
  const documentPath = process.argv[2];
  if (!documentPath) throw new Error('Usage: npm run platform:register -- <client.json>');
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const document = parsePlatformClientDocument(await readFile(resolve(documentPath), 'utf8'));
  const pool = createPostgresPool(databaseUrl);
  try {
    const service = new PlatformClientRegistrationService(
      new PostgresPlatformClientRepository(pool),
    );
    const result = await service.register(document, {
      allowInsecureLocalhost: process.env.AICARD_ALLOW_INSECURE_LOCALHOST_CLIENT === 'true',
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Platform registration failed'}\n`);
    process.exitCode = 1;
  });
}
