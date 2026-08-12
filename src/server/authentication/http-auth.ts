import { tokensMatch } from '@/server/authentication/auth-security';
import { AuthenticationStateError } from '@/server/authentication/errors';

export const SESSION_COOKIE = 'aicard_session';
export const CSRF_COOKIE = 'aicard_csrf';
export const CSRF_HEADER = 'x-csrf-token';

function readCookie(request: Request, name: string): string | undefined {
  const cookieHeader = request.headers.get('cookie');
  if (!cookieHeader) return undefined;
  for (const item of cookieHeader.split(';')) {
    const [rawName, ...rawValue] = item.trim().split('=');
    if (rawName === name) return decodeURIComponent(rawValue.join('='));
  }
  return undefined;
}

export function assertMutationOrigin(request: Request, expectedOrigin: string): void {
  if (request.headers.get('origin') !== expectedOrigin) {
    throw new AuthenticationStateError('Request origin was rejected');
  }
}

export function readSessionToken(request: Request): string | undefined {
  return readCookie(request, SESSION_COOKIE);
}

export function readCsrfToken(request: Request): string | undefined {
  return readCookie(request, CSRF_COOKIE);
}

export function requireCsrf(request: Request): void {
  const cookie = readCsrfToken(request);
  const header = request.headers.get(CSRF_HEADER) ?? undefined;
  if (!tokensMatch(cookie, header)) {
    throw new AuthenticationStateError('CSRF verification failed');
  }
}
