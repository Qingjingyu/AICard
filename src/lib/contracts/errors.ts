export type ErrorCode =
  | 'INVALID_REQUEST'
  | 'AUTHENTICATION_REQUIRED'
  | 'AUTHORIZATION_DENIED'
  | 'RESOURCE_CONFLICT'
  | 'RESOURCE_NOT_FOUND'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'
  | 'TEMPORARILY_UNAVAILABLE';

type ErrorInput = {
  code: ErrorCode;
  message: string;
  requestId: string;
  retryable: boolean;
};

export function createErrorEnvelope({ code, message, requestId, retryable }: ErrorInput) {
  return {
    error: {
      code,
      message,
      request_id: requestId,
      retryable,
    },
  } as const;
}
