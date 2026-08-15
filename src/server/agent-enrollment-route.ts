import { NextResponse } from 'next/server';
import type { ZodError } from 'zod';

import type { ErrorCode } from '@/lib/contracts/errors';
import { createErrorEnvelope } from '@/lib/contracts/errors';
import {
  AgentEnrollmentStateError,
  AgentEnrollmentVerificationError,
} from '@/server/agent-enrollment-errors';
import { requestId } from '@/server/authentication/auth-route';
import { AuthenticationStateError } from '@/server/authentication/errors';
import { IdentityConflictError } from '@/server/identity-errors';
import { PlatformAccessTokenError, PlatformAuthorizationError } from '@/server/authorization/errors';

export function agentJson(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: { 'cache-control': 'no-store' } });
}

export function agentErrorResponse(error: unknown, id = requestId()): NextResponse {
  let status = 500;
  let code: ErrorCode = 'INTERNAL_ERROR';
  let message = 'Agent enrollment request could not be completed';
  let retryable = true;

  if ((error as ZodError)?.name === 'ZodError') {
    status = 400;
    code = 'INVALID_REQUEST';
    message = 'Request data is invalid';
    retryable = false;
  } else if (error instanceof AgentEnrollmentVerificationError) {
    status = 401;
    code = 'AUTHENTICATION_REQUIRED';
    message = error.message;
    retryable = false;
  } else if (error instanceof PlatformAccessTokenError) {
    status = 401;
    code = 'AUTHENTICATION_REQUIRED';
    message = error.message;
    retryable = false;
  } else if (error instanceof PlatformAuthorizationError) {
    status = 403;
    code = 'AUTHORIZATION_DENIED';
    message = error.message;
    retryable = false;
  } else if (error instanceof AgentEnrollmentStateError || error instanceof IdentityConflictError) {
    status = 409;
    code = 'RESOURCE_CONFLICT';
    message = error.message;
    retryable = false;
  } else if (error instanceof AuthenticationStateError) {
    retryable = false;
    if (error.message === 'Authentication is required') {
      status = 401;
      code = 'AUTHENTICATION_REQUIRED';
    } else if (error.message.includes('origin') || error.message.includes('CSRF')) {
      status = 403;
      code = 'AUTHORIZATION_DENIED';
      message = 'Request security verification failed';
    } else if (error.message.includes('Too many')) {
      status = 429;
      code = 'RATE_LIMITED';
      retryable = true;
    } else {
      status = 409;
      code = 'RESOURCE_CONFLICT';
    }
    if (message === 'Agent enrollment request could not be completed') message = error.message;
  }

  return agentJson(createErrorEnvelope({ code, message, requestId: id, retryable }), status);
}

export function requestRateLimitKey(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || request.headers.get('x-real-ip') || 'local-client';
}
