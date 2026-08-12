export class IdentityNotFoundError extends Error {
  constructor() {
    super('AI Card was not found');
    this.name = 'IdentityNotFoundError';
  }
}

export class IdentityConflictError extends Error {
  constructor(message = 'AI Card identity conflicts with an existing record') {
    super(message);
    this.name = 'IdentityConflictError';
  }
}

export class IdentityStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IdentityStateError';
  }
}
