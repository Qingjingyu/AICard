import { createHash, randomUUID } from 'node:crypto';

import { NextResponse } from 'next/server';
import type { ZodError } from 'zod';

import type { ErrorCode } from '@/lib/contracts/errors';
import { createErrorEnvelope } from '@/lib/contracts/errors';
import type { AuthenticationService } from '@/server/authentication/authentication-service';
import {
  AuthenticationStateError,
  AuthenticationVerificationError,
} from '@/server/authentication/errors';
import { CSRF_COOKIE, readSessionToken, SESSION_COOKIE } from '@/server/authentication/http-auth';
import type { ServerConfig } from '@/server/config';

const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const REVERIFICATION_MAX_AGE_MS = 5 * 60 * 1_000;

export function requestId(): string {
  return randomUUID();
}

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: { 'cache-control': 'no-store' } });
}

export function setSessionCookies(
  response: NextResponse,
  input: { sessionToken: string; csrfToken: string },
  config: Pick<ServerConfig, 'nodeEnv'>,
): void {
  const secure = config.nodeEnv === 'production';
  response.cookies.set(SESSION_COOKIE, input.sessionToken, {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  response.cookies.set(CSRF_COOKIE, input.csrfToken, {
    httpOnly: false,
    secure,
    sameSite: 'strict',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export function clearSessionCookies(response: NextResponse, config: ServerConfig): void {
  const options = { secure: config.nodeEnv === 'production', sameSite: 'strict' as const, path: '/', maxAge: 0 };
  response.cookies.set(SESSION_COOKIE, '', { ...options, httpOnly: true });
  response.cookies.set(CSRF_COOKIE, '', { ...options, httpOnly: false });
}

export async function resolveRequestSession(request: Request, service: AuthenticationService) {
  const token = readSessionToken(request);
  if (!token) return null;
  const session = await service.resolveSession(token);
  return session ? { ...session, token } : null;
}

export async function requireRequestSession(request: Request, service: AuthenticationService) {
  const session = await resolveRequestSession(request, service);
  if (!session) throw new AuthenticationStateError('Authentication is required');
  return session;
}

export function requireRecentVerification(verifiedAt: Date): void {
  if (Date.now() - verifiedAt.getTime() > REVERIFICATION_MAX_AGE_MS) {
    throw new AuthenticationStateError('Recent identity verification is required');
  }
}

export async function enforceRateLimit(
  service: AuthenticationService,
  scope: string,
  key: string,
  maxAttempts: number,
  windowMs: number,
): Promise<void> {
  const keyHash = createHash('sha256').update(`${scope}\0${key}`, 'utf8').digest();
  const result = await service.consumeRateLimit({ scope, keyHash, maxAttempts, windowMs });
  if (!result.allowed) {
    const error = new AuthenticationStateError('Too many authentication attempts');
    Object.assign(error, { retryAfterSeconds: result.retryAfterSeconds });
    throw error;
  }
}

export function authErrorResponse(error: unknown, id = requestId()): NextResponse {
  let status = 500;
  let code: ErrorCode = 'INTERNAL_ERROR';
  let message = 'Authentication request could not be completed';
  let retryable = true;

  if ((error as ZodError)?.name === 'ZodError') {
    status = 400;
    code = 'INVALID_REQUEST';
    message = 'Request data is invalid';
    retryable = false;
  } else if (error instanceof AuthenticationVerificationError) {
    status = 401;
    code = 'AUTHENTICATION_REQUIRED';
    message = error.message;
    retryable = false;
  } else if (error instanceof AuthenticationStateError) {
    retryable = false;
    if (error.message === 'Authentication is required') {
      status = 401;
      code = 'AUTHENTICATION_REQUIRED';
      message = error.message;
    } else if (error.message.includes('origin') || error.message.includes('CSRF')) {
      status = 403;
      code = 'AUTHORIZATION_DENIED';
      message = 'Request security verification failed';
    } else if (error.message.includes('Too many')) {
      status = 429;
      code = 'RATE_LIMITED';
      message = error.message;
      retryable = true;
    } else {
      status = 409;
      code = 'RESOURCE_CONFLICT';
      message = error.message;
    }
  } else if ((error as { code?: string })?.code === '23505') {
    status = 409;
    code = 'RESOURCE_CONFLICT';
    message = 'This handle or Passkey is already registered';
    retryable = false;
  }

  const response = json(createErrorEnvelope({ code, message, requestId: id, retryable }), status);
  const retryAfter = (error as { retryAfterSeconds?: number })?.retryAfterSeconds;
  if (status === 429 && retryAfter) response.headers.set('retry-after', String(retryAfter));
  return response;
}
