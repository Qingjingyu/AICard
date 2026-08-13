import { createServer } from 'node:http';

import { createReferenceProductHandler } from './app';
import { ProductFederationService } from '../src/server/federation/product-federation-service';
import { HttpProductIdentityGateway } from '../src/server/federation/product-identity-gateway';
import { createPostgresPool } from '../src/server/postgres/pool';
import { PostgresProductFederationRepository } from '../src/server/postgres/product-federation-repository';

const port = Number(process.env.REFERENCE_PRODUCT_PORT ?? 4174);
const productOrigin = process.env.REFERENCE_PRODUCT_ORIGIN ?? `http://localhost:${port}`;
const aiCardOrigin = process.env.AI_CARD_ORIGIN ?? 'http://localhost:3000';
const aiCardInternalOrigin = process.env.AI_CARD_INTERNAL_ORIGIN ?? aiCardOrigin;
const databaseUrl = process.env.REFERENCE_PRODUCT_DATABASE_URL ?? process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('REFERENCE_PRODUCT_DATABASE_URL or DATABASE_URL is required');

const pool = createPostgresPool(databaseUrl);
const federation = new ProductFederationService(
  new HttpProductIdentityGateway(aiCardInternalOrigin),
  new PostgresProductFederationRepository(pool),
  aiCardOrigin,
);
const handler = createReferenceProductHandler({
  productOrigin,
  clientId: 'test_client',
  redirectUri: `${productOrigin}/callback`,
  begin: (input) => federation.begin(input),
  authorizationUrl: (flow) => federation.authorizationUrl(flow),
  complete: (input) => federation.complete(input),
  resolveSession: (token) => federation.resolveSession(token),
});

function requestHeaders(headers: typeof import('node:http').IncomingMessage.prototype.headers): Array<[string, string]> {
  return Object.entries(headers).flatMap(([key, value]): Array<[string, string]> => {
    if (Array.isArray(value)) return value.map((item) => [key, item]);
    return value ? [[key, value]] : [];
  });
}

const server = createServer(async (incoming, outgoing) => {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
    const request = new Request(new URL(incoming.url ?? '/', productOrigin), {
      method: incoming.method,
      headers: requestHeaders(incoming.headers),
      body: ['GET', 'HEAD'].includes(incoming.method ?? 'GET') ? undefined : Buffer.concat(chunks),
    });
    const response = await handler(request);
    outgoing.statusCode = response.status;
    response.headers.forEach((value, key) => {
      if (key !== 'set-cookie') outgoing.setHeader(key, value);
    });
    const setCookies = response.headers.getSetCookie();
    if (setCookies.length) outgoing.setHeader('set-cookie', setCookies);
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    const detail = error instanceof Error
      ? `${error.name}: ${error.message}`
      : 'Unknown reference product error';
    process.stderr.write(`Reference product request failed: ${detail}\n`);
    outgoing.statusCode = 500;
    outgoing.setHeader('content-type', 'text/plain; charset=utf-8');
    outgoing.end('Reference product request failed');
  }
});

server.listen(port, 'localhost', () => {
  process.stdout.write(`Reference product listening on ${productOrigin}\n`);
});

async function shutdown() {
  server.close();
  await pool.end();
}

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
