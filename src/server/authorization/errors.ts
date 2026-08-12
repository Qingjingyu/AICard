export class PlatformAuthorizationError extends Error {
  constructor(message = 'Platform authorization request was rejected') {
    super(message);
    this.name = 'PlatformAuthorizationError';
  }
}

export class PlatformAccessTokenError extends Error {
  constructor(message = 'Access token is invalid or expired') {
    super(message);
    this.name = 'PlatformAccessTokenError';
  }
}
