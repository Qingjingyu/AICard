export class AuthenticationStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthenticationStateError';
  }
}

export class AuthenticationVerificationError extends Error {
  constructor(message = 'Passkey verification failed') {
    super(message);
    this.name = 'AuthenticationVerificationError';
  }
}
