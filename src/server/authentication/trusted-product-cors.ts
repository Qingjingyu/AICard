import { AuthenticationStateError } from '@/server/authentication/errors';
import type { ServerConfig } from '@/server/config';

type TrustedProductConfig = Pick<ServerConfig, 'appOrigin' | 'trustedProductOrigins'>;

const ALLOWED_METHODS = 'POST, OPTIONS';
const ALLOWED_HEADERS = 'content-type, idempotency-key, x-csrf-token';

function originOf(request: Request): string {
  return request.headers.get('origin') ?? '';
}

function isTrustedProductOrigin(origin: string, config: TrustedProductConfig): boolean {
  return config.trustedProductOrigins.includes(origin);
}

function appendVaryOrigin(headers: Headers): void {
  const values = new Set(
    (headers.get('vary') ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
  values.add('Origin');
  headers.set('vary', [...values].join(', '));
}

export function assertTrustedProductMutationOrigin(
  request: Request,
  config: TrustedProductConfig,
): void {
  const origin = originOf(request);
  if (origin !== config.appOrigin && !isTrustedProductOrigin(origin, config)) {
    throw new AuthenticationStateError('Request origin was rejected');
  }
}

export function withTrustedProductCors<T extends Response>(
  request: Request,
  response: T,
  config: TrustedProductConfig,
): T {
  const origin = originOf(request);
  if (!isTrustedProductOrigin(origin, config)) return response;
  response.headers.set('access-control-allow-origin', origin);
  response.headers.set('access-control-allow-credentials', 'true');
  appendVaryOrigin(response.headers);
  return response;
}

export function createTrustedProductPreflight(
  request: Request,
  config: TrustedProductConfig,
): Response {
  assertTrustedProductMutationOrigin(request, config);
  const response = new Response(null, { status: 204 });
  if (isTrustedProductOrigin(originOf(request), config)) {
    response.headers.set('access-control-allow-methods', ALLOWED_METHODS);
    response.headers.set('access-control-allow-headers', ALLOWED_HEADERS);
    response.headers.set('access-control-max-age', '600');
  }
  return withTrustedProductCors(request, response, config);
}
