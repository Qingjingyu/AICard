import { NextResponse } from 'next/server';
import type { ZodError } from 'zod';

import type { ErrorCode } from '@/lib/contracts/errors';
import { createErrorEnvelope } from '@/lib/contracts/errors';
import { PlatformAccessTokenError, PlatformAuthorizationError } from '@/server/authorization/errors';
import { requestId } from '@/server/authentication/auth-route';
import { AuthenticationStateError } from '@/server/authentication/errors';

export function authorizationJson(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: { 'cache-control': 'no-store' } });
}

export function authorizationErrorResponse(error: unknown, id = requestId()): NextResponse {
  let status = 500;
  let code: ErrorCode = 'INTERNAL_ERROR';
  let message = 'Platform authorization request could not be completed';
  let retryable = true;

  if ((error as ZodError)?.name === 'ZodError') {
    status = 400;
    code = 'INVALID_REQUEST';
    message = 'Request data is invalid';
    retryable = false;
  } else if (error instanceof PlatformAccessTokenError) {
    status = 401;
    code = 'AUTHENTICATION_REQUIRED';
    message = error.message;
    retryable = false;
  } else if (error instanceof PlatformAuthorizationError) {
    status = 400;
    code = 'AUTHORIZATION_DENIED';
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
    }
  }

  return authorizationJson(createErrorEnvelope({ code, message, requestId: id, retryable }), status);
}

export function readBearerToken(request: Request): string | undefined {
  const authorization = request.headers.get('authorization');
  const match = authorization?.match(/^Bearer (at_[A-Za-z0-9_-]{43})$/);
  return match?.[1];
}
